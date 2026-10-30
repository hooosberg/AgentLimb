/**
 * AgentLimb tool router
 *
 * Executes HOST_TOOLS against Chrome. Design goals (aligned with modern
 * agent-browser toolsets):
 *   - refs come from the always-present a11y content script (no per-call injection)
 *   - pointer/keyboard actions go through CDP on a PERSISTENT debugger session
 *   - background tabs are driven with focus emulation instead of focus stealing
 *   - batch actions run in one round trip
 */

const KEY_MAP = {
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  meta: { key: 'Meta', code: 'MetaLeft', vk: 91 },
  cmd: { key: 'Meta', code: 'MetaLeft', vk: 91 },
  ctrl: { key: 'Control', code: 'ControlLeft', vk: 17 },
  control: { key: 'Control', code: 'ControlLeft', vk: 17 },
  alt: { key: 'Alt', code: 'AltLeft', vk: 18 },
  shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
};
for (let i = 1; i <= 12; i++) KEY_MAP[`f${i}`] = { key: `F${i}`, code: `F${i}`, vk: 111 + i };
for (let c = 97; c <= 122; c++) {
  const ch = String.fromCharCode(c);
  const up = ch.toUpperCase();
  KEY_MAP[ch] = { key: ch, code: `Key${up}`, vk: c - 32 };
  KEY_MAP[up] = { key: up, code: `Key${up}`, vk: c - 32 };
}
for (let d = 0; d <= 9; d++) KEY_MAP[String(d)] = { key: String(d), code: `Digit${d}`, vk: 48 + d };

const INJECTABLE = /^(https?|file):/i;

export function createRouter({ debugger: dbg, indicator, marker = null }) {
  /** Tabs currently being driven by an agent (for the in-page indicator). */
  const driving = new Set();
  /**
   * The tab the agent is working on. Calls without a tabId stick to it instead of
   * following whatever tab the user happens to be looking at, so switching to
   * another tab (a video, a chat…) never redirects the agent's next action.
   */
  let agentTabId = null;

  // ── helpers ────────────────────────────────────────────────────────────────
  async function resolveTab(tabId) {
    if (tabId != null) {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (_) {
        throw new Error(`tab ${tabId} not found`);
      }
      // A tab created microseconds ago reports url:'' until the navigation
      // commits. Waiting here makes every tool usable right after tab_new.
      if (!tab.url) tab = (await waitForTabUrl(tabId, { timeoutMs: 4000 })) || tab;
      return claim(tab);
    }
    if (agentTabId != null) {
      const sticky = await chrome.tabs.get(agentTabId).catch(() => null);
      if (sticky) return claim(sticky);
      agentTabId = null; // closed: fall back to what the user is looking at
    }
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active) {
      const [any] = await chrome.tabs.query({ active: true });
      if (!any) throw new Error('no active tab available');
      return claim(any);
    }
    return claim(active);
  }

  /** Remember the agent's tab and show it on the tab strip (cosmetic, never throws). */
  function claim(tab) {
    agentTabId = tab.id;
    if (marker) void marker.mark(tab);
    return tab;
  }

  /** Poll until a tab has a committed URL (or give up after timeoutMs). */
  async function waitForTabUrl(tabId, { timeoutMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let tab = await chrome.tabs.get(tabId).catch(() => null);
    while (tab && !tab.url && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
      tab = await chrome.tabs.get(tabId).catch(() => null);
    }
    return tab;
  }

  function assertInjectable(tab) {
    if (!INJECTABLE.test(tab.url || '')) {
      throw new Error(`tab is not an http(s)/file page: ${tab.url || '(still initializing — retry in a moment)'}`);
    }
  }

  async function pageMessage(tab, message, timeoutMs = 8000) {
    const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
    if (!response) throw new Error('content script did not respond (page still loading?)');
    return response;
  }

  async function prepareForInput(tab, { showCursor = true } = {}) {
    const isActive = tab.active;
    if (!isActive) {
      await dbg.setFocusEmulation(tab.id, true);
      await dbg.muteForControl(tab.id);
    }
    if (showCursor) {
      driving.add(tab.id);
      chrome.tabs.sendMessage(tab.id, { type: 'AGENTLIMB_SHOW_INDICATOR', tabId: tab.id }, { frameId: 0 }).catch(() => {});
    }
    return isActive;
  }

  async function endInput(tab) {
    // Focus emulation stays enabled only while we keep acting; Chrome clears it
    // on detach. Leaving it on is harmless and avoids flapping.
  }

  function moveCursor(tab, x, y) {
    chrome.tabs.sendMessage(tab.id, { type: 'AGENTLIMB_MOVE_CURSOR', x, y }, { frameId: 0 }).catch(() => {});
  }

  async function resolvePoint(tab, args) {
    if (typeof args.x === 'number' && typeof args.y === 'number') {
      return { x: args.x, y: args.y };
    }
    let selector = args.selector;
    if (args.ref != null) {
      const res = await pageMessage(tab, { type: 'AGENTLIMB_RESOLVE_REF', ref: args.ref });
      if (!res.ok) throw new Error(res.error || `cannot resolve ref ${args.ref}`);
      return { x: res.x, y: res.y };
    }
    if (selector) {
      // Resolve inside the page: it scrolls the element into view first, so the
      // coordinates are always inside the viewport.
      const res = await pageMessage(tab, { type: 'AGENTLIMB_RESOLVE_SELECTOR', selector });
      if (!res.ok) throw new Error(res.error || `selector not found: ${selector}`);
      return { x: res.x, y: res.y };
    }
    throw new Error('provide ref, selector, or x/y coordinates');
  }

  async function dispatchMouse(tab, type, x, y, extra = {}) {
    await dbg.send(tab.id, 'Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      ...extra,
    });
  }

  async function pressKey(tab, keyName, modifiers = '') {
    const spec = KEY_MAP[String(keyName).toLowerCase()] || { key: keyName, code: `Key${keyName}`, vk: keyName.toUpperCase().charCodeAt(0) };
    const mods = String(modifiers).toLowerCase();
    const modifierFlags = {
      alt: mods.includes('alt') ? 1 : 0,
      ctrl: mods.includes('ctrl') ? 1 : 0,
      meta: mods.includes('meta') || mods.includes('cmd') ? 1 : 0,
      shift: mods.includes('shift') ? 1 : 0,
    };
    const modifiersBitmask = modifierFlags.alt * 1 + modifierFlags.ctrl * 2 + modifierFlags.meta * 4 + modifierFlags.shift * 8;
    const base = {
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
      modifiers: modifiersBitmask,
    };
    await dbg.send(tab.id, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await dbg.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  function describeTab(tab) {
    return {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || '',
      url: tab.url || '',
      active: !!tab.active,
      status: tab.status || '',
      muted: tab.mutedInfo?.muted === true,
      groupId: tab.groupId ?? -1,
    };
  }

  async function waitForTabLoad(tabId, timeoutMs = 15000) {
    const started = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ ok: false, error: 'load wait timed out' });
      }, timeoutMs);
      function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ ok: true, waitedMs: Date.now() - started });
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
      // Already complete?
      chrome.tabs.get(tabId).then((t) => {
        if (t.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve({ ok: true, waitedMs: Date.now() - started });
        }
      }).catch(() => {});
    });
  }

  // ── tool implementations ───────────────────────────────────────────────────
  const tools = {
    async tabs_context({ tabId } = {}) {
      if (tabId != null) {
        const tab = await resolveTab(tabId);
        return { ok: true, tab: describeTab(tab) };
      }
      const tabs = await chrome.tabs.query({});
      return {
        ok: true,
        count: tabs.length,
        tabs: tabs.map(describeTab),
      };
    },

    async tab_new({ url, active = false } = {}) {
      let targetUrl = url || 'about:blank';
      if (targetUrl !== 'about:blank' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(targetUrl)) {
        targetUrl = `https://${targetUrl}`;
      }
      const created = await chrome.tabs.create({ url: targetUrl, active: active === true });
      // Mark only AI-created tabs. Never regroup the user's existing tabs.
      // While the agent works the group is titled "⏳ AgentLimb" (see service-worker
      // setBusy), so match both spellings or every busy moment would spawn a second group.
      const groups = await chrome.tabGroups.query({ windowId: created.windowId });
      const existing = groups.find((group) => group.color === 'orange' && /^(⏳ )?AgentLimb$/.test(group.title || ''));
      const groupId = await chrome.tabs.group({
        tabIds: [created.id],
        ...(existing ? { groupId: existing.id } : { createProperties: { windowId: created.windowId } }),
      });
      if (!existing) await chrome.tabGroups.update(groupId, { title: 'AgentLimb', color: 'orange', collapsed: false });
      // Don't hand back a tab whose url is still '' — the very next tool call
      // (read_page / wait / computer) would be rejected by assertInjectable.
      const tab = (await waitForTabUrl(created.id, { timeoutMs: url ? 10000 : 1500 })) || created;
      agentTabId = tab.id;
      return { ok: true, tab: describeTab(tab), group: { id: groupId, title: 'AgentLimb', color: 'orange' } };
    },

    async tab_close({ tabId }) {
      await chrome.tabs.remove(tabId);
      driving.delete(tabId);
      if (agentTabId === tabId) agentTabId = null;
      return { ok: true, closed: tabId };
    },

    async tab_activate({ tabId }) {
      const tab = await resolveTab(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { ok: true, tab: describeTab(await chrome.tabs.get(tabId)) };
    },

    async read_page({ tabId, filter, depth, limit } = {}) {
      const tab = await resolveTab(tabId);
      assertInjectable(tab);
      const res = await pageMessage(tab, {
        type: 'AGENTLIMB_READ_PAGE',
        options: { filter, depth, limit },
      });
      if (!res.ok) throw new Error(res.error || 'read_page failed');
      return {
        ok: true,
        url: tab.url,
        title: tab.title,
        tree: res.tree,
        elementCount: res.count,
        truncated: !!res.truncated,
      };
    },

    async find({ tabId, query, selector, limit } = {}) {
      const tab = await resolveTab(tabId);
      assertInjectable(tab);
      const res = await pageMessage(tab, {
        type: 'AGENTLIMB_FIND',
        options: { query, selector, limit },
      });
      if (!res.ok) throw new Error(res.error || 'find failed');
      return { ok: true, count: res.count, matches: res.matches };
    },

    async computer(args = {}) {
      const tab = await resolveTab(args.tabId);
      assertInjectable(tab);
      const action = args.action;

      if (action === 'screenshot') {
        await dbg.attach(tab.id);
        const wasDriving = driving.has(tab.id);
        if (wasDriving) {
          await chrome.tabs.sendMessage(tab.id, { type: 'AGENTLIMB_HIDE_INDICATOR' }, { frameId: 0 }).catch(() => {});
        }
        try {
          const shot = await dbg.screenshot(tab.id, {
            format: args.format || 'jpeg',
            fullPage: args.fullPage === true,
          });
          return {
            ok: true,
            image: {
              data: shot.data,
              mimeType: `image/${shot.format}`,
              quality: shot.quality,
            },
          };
        } finally {
          if (wasDriving) {
            chrome.tabs.sendMessage(tab.id, { type: 'AGENTLIMB_SHOW_INDICATOR', tabId: tab.id }, { frameId: 0 }).catch(() => {});
          }
        }
      }

      await prepareForInput(tab);

      if (action === 'type') {
        const text = args.text != null ? args.text : args.value;
        if (text == null) throw new Error('type action requires text');
        // Focus the target first when a ref/selector is given.
        if (args.ref != null || args.selector) {
          const point = await resolvePoint(tab, args);
          await dispatchMouse(tab, 'mousePressed', point.x, point.y, { buttons: 1 });
          await dispatchMouse(tab, 'mouseReleased', point.x, point.y, { buttons: 0 });
        }
        const raw = String(text);
        const parts = raw.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) await dbg.send(tab.id, 'Input.insertText', { text: parts[i] });
          if (i < parts.length - 1) await pressKey(tab, 'Enter');
        }
        return { ok: true, typed: raw.length };
      }

      if (action === 'key') {
        if (!args.key) throw new Error('key action requires key');
        await pressKey(tab, args.key, args.modifiers);
        return { ok: true, key: args.key };
      }

      if (action === 'scroll') {
        const deltaY = typeof args.deltaY === 'number' ? args.deltaY
          : typeof args.amount === 'number'
            ? (args.direction === 'up' ? -Math.abs(args.amount) : Math.abs(args.amount)) * 100
            : 600;
        await dispatchMouse(tab, 'mouseWheel', args.x ?? 100, args.y ?? 100, { deltaX: 0, deltaY });
        return { ok: true, scrolled: deltaY };
      }

      if (action === 'drag') {
        const from = await resolvePoint(tab, { ref: args.ref, selector: args.selector, x: args.x, y: args.y });
        const to = await resolvePoint(tab, { ref: args.ref2, selector: args.selector2, x: args.x2, y: args.y2 });
        await dispatchMouse(tab, 'mouseMoved', from.x, from.y);
        await dispatchMouse(tab, 'mousePressed', from.x, from.y);
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          await dispatchMouse(tab, 'mouseMoved',
            Math.round(from.x + ((to.x - from.x) * i) / steps),
            Math.round(from.y + ((to.y - from.y) * i) / steps),
            { buttons: 1 });
        }
        await dispatchMouse(tab, 'mouseReleased', to.x, to.y);
        return { ok: true, from, to };
      }

      // click family + hover
      const point = await resolvePoint(tab, args);
      moveCursor(tab, point.x, point.y);
      if (action === 'hover') {
        await dispatchMouse(tab, 'mouseMoved', point.x, point.y);
        return { ok: true, ...point };
      }
      const clickCount = action === 'triple_click' ? 3 : action === 'double_click' ? 2 : 1;
      const button = action === 'right_click' ? 'right' : 'left';
      const buttons = button === 'right' ? 2 : 1;
      await dispatchMouse(tab, 'mouseMoved', point.x, point.y);
      await dispatchMouse(tab, 'mousePressed', point.x, point.y, { button, buttons, clickCount });
      await dispatchMouse(tab, 'mouseReleased', point.x, point.y, { button, buttons: 0, clickCount });
      return { ok: true, ...point, action };
    },

    async form_input({ tabId, ref, selector, value } = {}) {
      const tab = await resolveTab(tabId);
      assertInjectable(tab);
      const res = await pageMessage(tab, {
        type: 'AGENTLIMB_FORM_INPUT',
        options: { ref, selector, value },
      });
      if (!res.ok) throw new Error(res.error || 'form_input failed');
      return res;
    },

    async navigate({ url, tabId, waitForLoad = true, timeout = 15000 } = {}) {
      const tab = await resolveTab(tabId);
      if (url === 'back') {
        await chrome.tabs.goBack(tab.id);
        if (waitForLoad) await waitForTabLoad(tab.id, timeout);
        return { ok: true, url: (await chrome.tabs.get(tab.id)).url };
      }
      if (url === 'forward') {
        await chrome.tabs.goForward(tab.id);
        if (waitForLoad) await waitForTabLoad(tab.id, timeout);
        return { ok: true, url: (await chrome.tabs.get(tab.id)).url };
      }
      let targetUrl = String(url || '').trim();
      if (targetUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(targetUrl)) {
        targetUrl = `https://${targetUrl}`;
      }
      if (!/^https?:\/\//i.test(targetUrl)) throw new Error(`navigate requires an absolute http(s) URL: ${url}`);
      await chrome.tabs.update(tab.id, { url: targetUrl });
      if (waitForLoad) {
        const load = await waitForTabLoad(tab.id, timeout);
        if (!load.ok) return { ok: true, url: targetUrl, warning: load.error };
      }
      return { ok: true, url: targetUrl };
    },

    async javascript_eval({ expression, tabId } = {}) {
      const tab = await resolveTab(tabId);
      assertInjectable(tab);
      const result = await dbg.send(tab.id, 'Runtime.evaluate', {
        expression: String(expression),
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
        timeout: 15000,
      }, 20000);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval threw');
      }
      return { ok: true, result: result.result?.value };
    },

    async wait({ tabId, selector, text, condition, timeout } = {}) {
      const tab = await resolveTab(tabId);
      assertInjectable(tab);
      const res = await pageMessage(tab, {
        type: 'AGENTLIMB_WAIT',
        options: { selector, text, condition, timeout },
      }, Math.min((timeout || 10000) + 5000, 40000));
      return res;
    },

    async read_console_messages({ tabId, limit, level } = {}) {
      const tab = await resolveTab(tabId);
      const items = dbg.readConsole(tab.id, { limit, level });
      return { ok: true, count: items.length, messages: items };
    },

    async read_network_requests({ tabId, limit, urlFilter } = {}) {
      const tab = await resolveTab(tabId);
      const items = dbg.readNetwork(tab.id, { limit, urlFilter });
      return { ok: true, count: items.length, requests: items };
    },

    async browser_batch({ actions } = {}) {
      if (!Array.isArray(actions) || !actions.length) throw new Error('browser_batch requires actions[]');
      if (actions.length > 20) throw new Error('browser_batch supports at most 20 actions');
      const results = [];
      for (const entry of actions) {
        const name = entry && entry.tool;
        const fn = tools[name];
        if (!fn) {
          results.push({ tool: name, ok: false, error: `unknown tool: ${name}` });
          continue;
        }
        try {
          const result = await fn(entry.args || {});
          results.push({ tool: name, ...result });
        } catch (error) {
          results.push({ tool: name, ok: false, error: error.message });
          // Stop the batch on failure — subsequent steps likely depend on it.
          break;
        }
      }
      return { ok: results.every((r) => r.ok !== false), results };
    },

    async ping() {
      return { ok: true, pong: true, at: new Date().toISOString(), debugger: dbg.status() };
    },
  };

  async function execute(toolName, args = {}) {
    const fn = tools[toolName];
    if (!fn) throw new Error(`unknown tool: ${toolName}`);
    return fn(args);
  }

  return {
    execute,
    driving,
    stopDriving(tabId) {
      driving.delete(tabId);
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'AGENTLIMB_HIDE_INDICATOR' }, { frameId: 0 }).catch(() => {});
        dbg.restoreMute(tabId);
      }
    },
    stopAllDriving() {
      for (const tabId of [...driving]) {
        chrome.tabs.sendMessage(tabId, { type: 'AGENTLIMB_HIDE_INDICATOR' }, { frameId: 0 }).catch(() => {});
        dbg.restoreMute(tabId);
      }
      driving.clear();
      agentTabId = null;
      if (marker) void marker.clear();
    },
    resetAgentTab() {
      agentTabId = null;
    },
    get agentTabId() { return agentTabId; },
  };
}
