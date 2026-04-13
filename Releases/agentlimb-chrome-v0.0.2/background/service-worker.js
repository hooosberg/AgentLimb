/**
 * AgentLimb Service Worker v2
 *
 * Core coordinator for the Chrome extension. Extension is the "arms", terminal AI is the "brain".
 * Only executes browser operations and returns page state — no AI reasoning.
 *
 * Message routing:
 *   OBSERVE          → Page state: URL, title, DOM tree, optional screenshot
 *   EXECUTE_ACTION   → Single-step operation: click/type/select
 *   NAVIGATE         → Navigate to URL
 *   EVALUATE         → Execute JavaScript in page
 *   WAIT_FOR         → Wait for selector/text/URL condition
 *   SCREENSHOT       → Screenshot (used internally by observe)
 *   STOP_EXECUTION   → Stop current execution
 *   SAVE_MUSCLE / GET_MUSCLES / DELETE_MUSCLE / UPDATE_MUSCLE_STATS → Muscle storage
 */

let _stopRequested = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(e => {
    console.error('[agentlimb SW]', e);
    sendResponse({ ok: false, error: e.message });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'OBSERVE':         return observe(msg.filter, msg.screenshot);
    case 'NAVIGATE':        return navigate(msg.url);
    case 'EXECUTE_ACTION':  return executeSingleAction(msg.action);
    case 'EVALUATE':        return evaluate(msg.code, msg.timeout_ms);
    case 'SCREENSHOT':      return screenshot(msg.include_data);
    case 'STOP_EXECUTION':  _stopRequested = true; return { ok: true };
    case 'PROBE_TAB':       return probeCurrentTab();
    // Muscle storage (chrome.storage.local)
    case 'SAVE_MUSCLE':          return saveMuscle(msg.muscle);
    case 'GET_MUSCLES':          return getMuscles(msg.url_filter);
    case 'DELETE_MUSCLE':        return deleteMuscle(msg.id);
    case 'UPDATE_MUSCLE_STATS':  return updateMuscleStats(msg.muscle_id);
    default:                    return { ok: false, error: `Unknown: ${msg.type}` };
  }
}

// 点击图标打开 Side Panel
chrome.action.onClicked.addListener(async tab => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── OBSERVE：页面状态 + 可选截图 ──────────

async function observe(filter = 'interactive', includeScreenshot = false) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 注入内容脚本，失败时 fast-fail 并自动截图辅助诊断
    const injection = await injectScript(tab.id, 'content/injector.js');
    if (!injection.ok) {
      const failState = {
        ok: false, url: tab.url, title: tab.title,
        error: injection.message,
        error_type: injection.reason, // 'permission_denied' | 'restricted_page' | 'unknown'
        tree: '', element_count: 0,
      };
      // 自动截图帮助 AI 诊断页面状态
      try {
        const shot = await screenshot(true);
        if (shot.ok) failState.screenshot = { data_url: shot.dataUrl, size_kb: shot.size_kb };
      } catch {}
      return failState;
    }

    const result = await sendToTab(tab.id, { type: 'AGENTLIMB_GET_ELEMENTS', filter }, 5000);

    const state = {
      ok: true,
      url: tab.url,
      title: tab.title,
      tree: result?.tree || '',
      element_count: result?.count || 0,
    };

    // 注入成功但内容脚本没响应：也自动截图
    if (!result) {
      state.ok = false;
      state.error = 'Content script injected but not responding. Page may still be loading or has strict CSP.';
      state.error_type = 'script_unresponsive';
      try {
        const shot = await screenshot(true);
        if (shot.ok) state.screenshot = { data_url: shot.dataUrl, size_kb: shot.size_kb };
      } catch {}
    }

    if (includeScreenshot && state.ok) {
      const shot = await screenshot(true);
      if (shot.ok) {
        state.screenshot = { data_url: shot.dataUrl, size_kb: shot.size_kb };
      }
    }

    return state;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── EXECUTE_ACTION：单步 DOM 操作 ─────────

async function executeSingleAction(action) {
  try {
    // 归一化 ref_id：接受 "ref_41" 字符串，自动提取数字 41
    if (action.ref_id !== undefined) {
      const raw = String(action.ref_id);
      if (/^ref_\d+$/i.test(raw)) {
        action = { ...action, ref_id: parseInt(raw.replace(/^ref_/i, ''), 10) };
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 点击前压制 alert/confirm/prompt
    if (action.type === 'click') {
      await suppressDialogs(tab.id);
    }

    // ── type 操作：分层策略 ──
    // 1. 先通过 content script 聚焦元素，获取元素信息
    // 2. contenteditable → CDP 真实键盘输入（最可靠，isTrusted:true）
    // 3. contenteditable CDP 失败 → MAIN world execCommand 多级策略
    // 4. input/textarea → native setter（React/Vue 兼容）
    if (action.type === 'type') {
      const injection = await injectScript(tab.id, 'content/injector.js');
      if (!injection.ok) {
        const fail = { ok: false, error: injection.message, error_type: injection.reason };
        try { const s = await screenshot(true); if (s.ok) fail.screenshot = { data_url: s.dataUrl, size_kb: s.size_kb }; } catch {}
        return fail;
      }

      // Step 1: 聚焦元素并获取类型信息
      const focusResult = await sendToTab(tab.id, {
        type: 'AGENTLIMB_FOCUS_FOR_TYPE',
        action: { ref_id: action.ref_id, selector: action.selector },
      }, 5000);

      if (!focusResult?.ok) {
        // Fallback: 旧路径
        const result = await sendToTab(tab.id, { type: 'AGENTLIMB_EXECUTE_ACTION', action }, 8000);
        return result || { ok: false, error: 'Content script not responding', error_type: 'script_unresponsive' };
      }

      const value = String(action.value || '');
      const targetInfo = {
        target_label: focusResult.target_label,
        target_selector: focusResult.target_selector || focusResult.resolvedSelector,
        target_candidates: focusResult.target_candidates || [],
      };

      // Step 2: contenteditable → CDP 真实键盘输入
      if (focusResult.isContentEditable) {
        const cdpResult = await cdpType(tab.id, value);
        if (cdpResult.ok) return { ok: true, contenteditable: true, method: cdpResult.method, ...targetInfo };

        // Step 3: CDP 失败 → MAIN world execCommand 多级策略
        const selector = focusResult.resolvedSelector;
        if (selector) {
          const mainResult = await tryExecCommandStrategies(tab.id, selector, value);
          if (mainResult?.handled) return { ok: true, contenteditable: true, method: mainResult.method, lines: mainResult.lines, ...targetInfo };
        }

        // Step 4: 最终 fallback → content script innerHTML
        const fallback = await sendToTab(tab.id, { type: 'AGENTLIMB_EXECUTE_ACTION', action }, 8000);
        return fallback || { ok: false, error: 'All type strategies failed for contenteditable' };
      }

      // input/textarea: native setter（React/Vue 兼容）
      const result = await sendToTab(tab.id, { type: 'AGENTLIMB_EXECUTE_ACTION', action }, 8000);
      return result || { ok: false, error: 'Content script not responding', error_type: 'script_unresponsive' };
    }

    // ── 非 type 操作 ──
    const injection = await injectScript(tab.id, 'content/injector.js');
    if (!injection.ok) {
      const fail = { ok: false, error: injection.message, error_type: injection.reason };
      try { const s = await screenshot(true); if (s.ok) fail.screenshot = { data_url: s.dataUrl, size_kb: s.size_kb }; } catch {}
      return fail;
    }
    const result = await sendToTab(tab.id, { type: 'AGENTLIMB_EXECUTE_ACTION', action }, 8000);
    if (!result) {
      const fail = { ok: false, error: 'Content script injected but not responding', error_type: 'script_unresponsive' };
      try { const s = await screenshot(true); if (s.ok) fail.screenshot = { data_url: s.dataUrl, size_kb: s.size_kb }; } catch {}
      return fail;
    }
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── CDP 真实键盘输入（绕过 isTrusted 检查 + React/Draft.js 状态同步）──────
// 通过 Chrome DevTools Protocol 发送输入，与真实键盘完全一致
async function cdpType(tabId, text) {
  try {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (e) {
      if (e.message?.includes('Another debugger')) {
        try { await chrome.debugger.detach({ tabId }); } catch {}
        await chrome.debugger.attach({ tabId }, '1.3');
      } else {
        return { ok: false, error: e.message };
      }
    }

    // 选中已有内容并删除
    // macOS 用 Meta(Cmd)=4, Windows/Linux 用 Ctrl=2
    const isMac = navigator.userAgent?.includes('Mac') || navigator.platform?.includes('Mac');
    const selectMod = isMac ? 4 : 2;

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', modifiers: selectMod,
      key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', modifiers: selectMod,
      key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
    });
    await delay(30);

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
    });
    await delay(30);

    // 插入文本 — Input.insertText 模拟 IME 提交，触发完整事件链
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });

    await chrome.debugger.detach({ tabId });
    return { ok: true, method: 'cdp' };
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return { ok: false, error: e.message };
  }
}

// ── MAIN world execCommand 多级策略（contenteditable fallback）──────
async function tryExecCommandStrategies(tabId, selector, val) {
  const mainResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [selector, val],
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el || !el.isContentEditable) return { handled: false };

      const expectedLines = val.split('\n').length;
      const getLines = e => e.innerText.replace(/\n$/, '').split('\n').length;

      function clearInsert(text) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        return document.execCommand('insertText', false, text);
      }

      // Strategy 1: insertText
      clearInsert(val);
      if (getLines(el) === expectedLines) {
        el.dataset.agentlimbCeFilled = 'true';
        return { handled: true, method: 'insertText', lines: getLines(el) };
      }

      // Strategy 2: beforeinput + input events (Draft.js / ProseMirror)
      try {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        for (const ch of val) {
          if (ch === '\n') {
            el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertParagraph' }));
            document.execCommand('insertParagraph', false, null);
          } else {
            el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
            document.execCommand('insertText', false, ch);
          }
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
        if (el.innerText.trim().length > 0) {
          el.dataset.agentlimbCeFilled = 'true';
          return { handled: true, method: 'beforeinput-chars', lines: getLines(el) };
        }
      } catch (_) {}

      // Strategy 3: paste simulation
      try {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        const dt = new DataTransfer();
        dt.setData('text/plain', val);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: val }));
        if (el.innerText.trim().length > 0) {
          el.dataset.agentlimbCeFilled = 'true';
          return { handled: true, method: 'paste', lines: getLines(el) };
        }
      } catch (_) {}

      return { handled: false };
    },
  }).catch(() => null);

  return mainResult?.[0]?.result || null;
}

async function suppressDialogs(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (window.__agentlimbDialogsSuppressed) return;
        window.__agentlimbDialogsSuppressed = true;
        window.alert = (msg) => console.log('[agentlimb] alert suppressed:', msg);
        window.confirm = (msg) => { console.log('[agentlimb] confirm → true:', msg); return true; };
        window.prompt = (msg) => { console.log('[agentlimb] prompt → null:', msg); return null; };
      },
    });
  } catch {}
}

// ── EVALUATE：在页面 MAIN world 执行任意 JS ──────────────
// host_permissions: <all_urls> → 无需动态权限请求
// 带 timeout_ms 时启用轮询模式（替代旧 wait 工具）

async function runInMainWorld(tabId, code) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [code],
      func: (code) => {
        try {
          const r = eval(code);
          if (r instanceof HTMLElement) return { ok: true, result: r.outerHTML.slice(0, 500), type: 'element' };
          if (r instanceof NodeList || r instanceof HTMLCollection) return { ok: true, result: Array.from(r).map(e => e.outerHTML.slice(0, 200)), type: 'nodelist', count: r.length };
          if (r instanceof Promise) return { ok: false, error: 'Use async wrapper: (async () => { ... })()' };
          if (r === undefined || r === null) return { ok: true, result: null };
          try { return { ok: true, result: JSON.parse(JSON.stringify(r)) }; }
          catch { return { ok: true, result: String(r) }; }
        } catch (e) {
          return { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3).join('\n') };
        }
      },
    });
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function evaluate(code, timeoutMs) {
  try {
    if (!code) return { ok: false, error: 'code is required' };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
      return { ok: false, error: `eval requires http/https page, current: ${tab?.url || 'none'}` };
    }

    // 单次执行
    if (!timeoutMs || timeoutMs <= 0) {
      return await runInMainWorld(tab.id, code);
    }

    // 轮询模式：执行 code 直到返回 truthy 或超时
    const deadline = Date.now() + timeoutMs;
    let lastResult = null;
    while (Date.now() < deadline) {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      lastResult = await runInMainWorld(currentTab.id, code);
      if (lastResult.ok && lastResult.result) return lastResult;
      await delay(500);
    }
    return { ok: false, error: `Timeout (${timeoutMs}ms)`, last_result: lastResult?.result, current_url: tab.url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── NAVIGATE ────────────────────────────

async function navigate(url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  await chrome.tabs.update(tab.id, { url });
  await waitForTabComplete(tab.id, 15000);
  const [updated] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { ok: true, tabId: tab.id, final_url: updated?.url || url };
}

function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 800);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── SCREENSHOT ──────────────────────────

async function screenshot(includeData = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        const win = await chrome.windows.get(tab.windowId);
        if (win.state === 'minimized' || attempt >= 2) {
          if (attempt >= 2 && win.state !== 'minimized') {
            await chrome.windows.update(tab.windowId, { state: 'minimized' });
            await delay(400);
          }
          await chrome.windows.update(tab.windowId, { state: 'normal', focused: true });
          await delay(600);
        } else {
          await chrome.windows.update(tab.windowId, { focused: true });
          await delay(200);
        }
      } catch {}

      if (attempt >= 1) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => { window.scrollBy(0, 1); window.scrollBy(0, -1); },
          });
          await delay(300);
        } catch {}
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      const base64 = dataUrl.split(',')[1] || '';
      const size_bytes = Math.round(base64.length * 0.75);
      const result = {
        ok: true, format: 'jpeg', size_bytes,
        size_kb: Math.round(size_bytes / 1024),
        page_url: tab.url, page_title: tab.title,
      };
      if (includeData) result.dataUrl = dataUrl;
      else result.note = 'Pass screenshot:true to observe, or include_data:true to get base64';
      return result;
    } catch (e) {
      if (e.message.includes('MAX_CAPTURE') || e.message.includes('readback') || e.message.includes('capture') || e.message.includes('Failed')) {
        await delay([0, 1500, 3000, 5000][attempt] || 3000);
        continue;
      }
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'Screenshot failed after 4 attempts' };
}

// ── 工具函数 ────────────────────────────

async function ensureHostPermission(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  const origin = new URL(url).origin + '/*';
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  // 请求权限（用户会看到弹窗确认）
  try { return await chrome.permissions.request({ origins: [origin] }); }
  catch { return false; }
}

/**
 * 注入内容脚本，返回注入结果：
 *   { ok: true }
 *   { ok: false, reason: 'permission_denied' | 'restricted_page' | 'unknown', message: string }
 */
async function injectScript(tabId, file) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    return { ok: true };
  } catch (e) {
    // 权限不足时尝试动态请求
    if (/Cannot access|missing host permission/i.test(e.message)) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && await ensureHostPermission(tab.url)) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
          return { ok: true };
        } catch (e2) {
          return { ok: false, reason: 'permission_denied', message: `Permission granted but injection still failed: ${e2.message}` };
        }
      }
      const pageUrl = tab?.url || '';
      if (/^chrome(-extension)?:\/\//.test(pageUrl)) {
        return { ok: false, reason: 'restricted_page', message: `Cannot inject into ${pageUrl}. Navigate to an http/https page first.` };
      }
      return { ok: false, reason: 'permission_denied', message: `Host permission denied for this page. User needs to grant access via AgentLimb side panel.` };
    }
    if (/chrome:\/\/|chrome-extension:\/\//.test(e.message)) {
      return { ok: false, reason: 'restricted_page', message: e.message };
    }
    return { ok: false, reason: 'unknown', message: e.message };
  }
}

/**
 * 探测当前标签页的注入状态（/doctor 用）
 */
async function probeCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { ok: false, error: 'No active tab', error_type: 'no_tab' };

    const probe = { ok: true, url: tab.url, title: tab.title };

    if (!/^https?:\/\//.test(tab.url)) {
      probe.ok = false;
      probe.error = `Page ${tab.url} is not http/https — content script cannot be injected`;
      probe.error_type = 'restricted_page';
      probe.injection = 'blocked';
      probe.script_responsive = false;
      return probe;
    }

    // 尝试注入
    const injection = await injectScript(tab.id, 'content/injector.js');
    probe.injection = injection.ok ? 'success' : 'failed';
    if (!injection.ok) {
      probe.ok = false;
      probe.error = injection.message;
      probe.error_type = injection.reason;
      probe.script_responsive = false;
      return probe;
    }

    // 注入成功，测试通信
    const pong = await sendToTab(tab.id, { type: 'AGENTLIMB_CHECK_TEXT', text: '' }, 2000);
    probe.script_responsive = pong !== null;
    if (!pong) {
      probe.ok = false;
      probe.error = 'Content script injected but not responding (2s timeout)';
      probe.error_type = 'script_unresponsive';
    }
    return probe;
  } catch (e) {
    return { ok: false, error: e.message, error_type: 'unknown' };
  }
}

function sendToTab(tabId, msg, timeout = 8000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeout);
    chrome.tabs.sendMessage(tabId, msg, res => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Muscle storage (chrome.storage.local) ──────

const MUSCLES_KEY = 'agentlimb_muscles';

async function migrateStorage() {
  const data = await chrome.storage.local.get(['cowork_routes', 'cowork_project']);
  if (data.cowork_routes) {
    await chrome.storage.local.set({ agentlimb_muscles: data.cowork_routes });
    await chrome.storage.local.remove('cowork_routes');
  }
  if (data.cowork_project) {
    await chrome.storage.local.set({ agentlimb_project: data.cowork_project });
    await chrome.storage.local.remove('cowork_project');
  }
}

migrateStorage();

async function loadMuscleStore() {
  const data = await chrome.storage.local.get(MUSCLES_KEY);
  const store = data[MUSCLES_KEY] || {};
  let changed = false;
  const normalizedStore = {};
  for (const [key, muscle] of Object.entries(store)) {
    const id = muscle?.id || muscle?.name || key;
    if (!id) continue;
    const normalized = canonicalizeMuscle({ ...muscle, id }, muscle);
    normalizedStore[id] = normalized;
    if (id !== key || JSON.stringify(normalized) !== JSON.stringify(muscle)) changed = true;
  }
  if (changed) await chrome.storage.local.set({ [MUSCLES_KEY]: normalizedStore });
  return normalizedStore;
}

async function saveMuscleStore(store) {
  await chrome.storage.local.set({ [MUSCLES_KEY]: store });
}

function escapeRegExp(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegExp(pattern) {
  return new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`, 'i');
}

function looksLikeRegexPattern(pattern) {
  return /(^\^)|(\$$)|[()[\]{}+?|\\]/.test(pattern);
}

function parseUrlLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', url: '', host: '' };
  try {
    const parsed = new URL(raw);
    return { raw, url: parsed.href, host: parsed.hostname };
  } catch {
    const host = raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
    return { raw, url: raw, host };
  }
}

function matchesSitePattern(pattern, url) {
  const rawPattern = String(pattern || '').trim();
  if (!rawPattern) return true;

  const target = parseUrlLike(url);
  const targetValue = rawPattern.includes('://') || rawPattern.includes('/') ? target.url : target.host;
  if (!targetValue) return false;

  if (/^\/.*\/[a-z]*$/i.test(rawPattern)) {
    try {
      const lastSlash = rawPattern.lastIndexOf('/');
      const body = rawPattern.slice(1, lastSlash);
      const flags = rawPattern.slice(lastSlash + 1);
      return new RegExp(body, flags).test(targetValue);
    } catch {}
  }

  if (rawPattern.includes('*')) return wildcardToRegExp(rawPattern).test(targetValue);

  if (looksLikeRegexPattern(rawPattern)) {
    try {
      return new RegExp(rawPattern, 'i').test(targetValue);
    } catch {}
  }

  if (rawPattern.includes('://') || rawPattern.includes('/')) return targetValue.includes(rawPattern);
  return target.host === rawPattern || target.host.endsWith(`.${rawPattern}`);
}

function legacyActionsToSteps(actions = []) {
  return actions.map(action => {
    const step = { do: action.type || action.tool };
    if (action.selector) step.el = [action.selector];
    if (action.field) step.param = action.field;
    else if (action.value !== undefined) step.value = action.value;
    if (action.url) step.url = action.url;
    if (action.url_pattern || action.pattern) step.pattern = action.url_pattern || action.pattern;
    if (action.code) step.code = action.code;
    if (action.text) step.text = action.text;
    if (action.delay) step.delay = action.delay;
    if (action.timeout || action.timeout_ms) step.timeout = action.timeout || action.timeout_ms;
    if (action.property) step.property = action.property;
    return step;
  });
}

function getMuscleSteps(muscle) {
  if (Array.isArray(muscle?.steps)) return muscle.steps;
  if (Array.isArray(muscle?.actions)) return legacyActionsToSteps(muscle.actions);
  return [];
}

function getMuscleParams(muscle, steps = getMuscleSteps(muscle)) {
  if (Array.isArray(muscle?.params) && muscle.params.length) {
    return [...new Set(muscle.params.filter(Boolean))];
  }
  return [...new Set(steps.map(step => step?.param || step?.field).filter(Boolean))];
}

function canonicalizeMuscle(muscle, fallback = {}) {
  const id = muscle?.id || muscle?.name || fallback?.id || fallback?.name;
  const steps = getMuscleSteps(muscle);
  return {
    id,
    desc: muscle?.desc || muscle?.name || fallback?.desc || fallback?.name || id,
    site: muscle?.site || muscle?.url_pattern || fallback?.site || fallback?.url_pattern || '',
    params: getMuscleParams(muscle, steps),
    steps,
    version: muscle?.version || fallback?.version || 1,
    created_at: muscle?.created_at || fallback?.created_at || new Date().toISOString(),
    updated_at: muscle?.updated_at || fallback?.updated_at || new Date().toISOString(),
    successful_runs: muscle?.successful_runs || fallback?.successful_runs || 0,
    confidence: muscle?.confidence || fallback?.confidence || 'low',
    last_success: muscle?.last_success || fallback?.last_success,
  };
}

function normalizeMuscleForSave(muscle, existing = {}) {
  const canonical = canonicalizeMuscle(muscle, existing);
  return {
    ...canonical,
    version: (existing?.version || 0) + 1,
    created_at: existing?.created_at || canonical.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    successful_runs: existing?.successful_runs || canonical.successful_runs || 0,
    confidence: existing?.confidence || canonical.confidence || 'low',
    last_success: existing?.last_success || canonical.last_success,
  };
}

async function saveMuscle(muscle) {
  if (!muscle?.id && !muscle?.name) return { ok: false, error: 'muscle.id (or muscle.name) required' };
  if (!Array.isArray(muscle?.steps) && !Array.isArray(muscle?.actions)) {
    return { ok: false, error: 'muscle.steps required (or legacy muscle.actions)' };
  }
  const store = await loadMuscleStore();
  const id = muscle.id || muscle.name;
  const existing = store[id];
  store[id] = normalizeMuscleForSave({ ...muscle, id }, existing);
  await saveMuscleStore(store);
  return { ok: true, muscle: store[id] };
}

async function getMuscles(urlFilter) {
  const store = await loadMuscleStore();
  let muscles = Object.values(store).map(r => canonicalizeMuscle(r, r));
  if (urlFilter) muscles = muscles.filter(r => matchesSitePattern(r.site || r.url_pattern, urlFilter));
  return { ok: true, count: muscles.length, muscles };
}

async function deleteMuscle(id) {
  if (!id) return { ok: false, error: 'id required' };
  const store = await loadMuscleStore();
  if (!store[id]) return { ok: false, error: 'Muscle not found' };
  delete store[id];
  await saveMuscleStore(store);
  return { ok: true };
}

async function updateMuscleStats(muscleId) {
  if (!muscleId) return { ok: false, error: 'muscle_id required' };
  const store = await loadMuscleStore();
  if (!store[muscleId]) return { ok: false, error: 'Muscle not found' };
  const r = store[muscleId];
  r.successful_runs = (r.successful_runs || 0) + 1;
  r.last_success = new Date().toISOString();
  const ASSERT = new Set(['assert_text', 'assert_url', 'assert_selector', 'wait_for_text']);
  const hasAssert = getMuscleSteps(r).some(step => ASSERT.has(step.do || step.type));
  r.confidence = r.successful_runs >= 5 ? 'high'
    : r.successful_runs >= 2 ? 'medium'
    : (hasAssert && r.successful_runs >= 1) ? 'medium'
    : 'low';
  await saveMuscleStore(store);
  return { ok: true, muscle: r };
}
