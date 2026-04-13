/**
 * AgentLimb Injector v3 — DOM content script (minimal)
 *
 * Handles:
 *   AGENTLIMB_GET_ELEMENTS    → Accessibility tree snapshot (ref_id system)
 *   AGENTLIMB_EXECUTE_ACTION  → Single-step DOM operation (click / type / select)
 *
 * eval/wait/query → handled by MAIN world chrome.scripting.executeScript, not content script.
 * ref_id system: Re-scanned each GET_ELEMENTS call, WeakRef storage to avoid memory leaks.
 */

(function () {
  if (window.__agentlimbInjected) return;
  window.__agentlimbInjected = true;

  window.__agentlimbElementMap = {};
  window.__agentlimbRefCounter = 0;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleMsg(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  async function handleMsg(msg) {
    switch (msg.type) {
      case 'AGENTLIMB_GET_ELEMENTS':   return getAccessibilityTree(msg.filter || 'interactive');
      case 'AGENTLIMB_EXECUTE_ACTION': return executeAction(msg.action);
      case 'AGENTLIMB_FOCUS_FOR_TYPE': return focusForType(msg.action);
      default: return { ok: false, error: `Unknown: ${msg.type}` };
    }
  }

  // ── 聚焦元素并返回类型信息（供 service-worker 选择输入策略）──
  async function focusForType(action) {
    const { ref_id, selector } = action;
    let el = null;
    if (ref_id != null) {
      const weakRef = window.__agentlimbElementMap[ref_id];
      el = weakRef?.deref() ?? null;
      if (!el) return { ok: false, error: `ref_${ref_id} expired — call observe again` };
    }
    if (!el && selector) {
      el = findBySelector(selector);
      if (!el) return { ok: false, error: `selector "${selector}" not found` };
    }
    if (!el) return { ok: false, error: 'No element specified' };

    // 滚动 + 点击激活（contenteditable 编辑器通常需要 click 而非仅 focus）
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    await delay(100);
    el.click();
    await delay(100);
    el.focus();
    await delay(150);

    const target = getTargetInfo(el);

    return {
      ok: true,
      isContentEditable: el.isContentEditable,
      tagName: el.tagName,
      resolvedSelector: target.target_selector || null,
      ...target,
    };
  }

  // ── 可访问性树 ────────────────────────

  const INTERACTIVE_SELECTOR = [
    'input:not([type="hidden"])', 'textarea', 'button',
    '[role="textbox"]', '[role="button"]', '[contenteditable="true"]',
    'select', 'a[href]',
  ].join(',');

  function getAccessibilityTree(filterMode = 'interactive') {
    window.__agentlimbElementMap = {};
    window.__agentlimbRefCounter = (window.__agentlimbRefCounter || 0);

    const selector = filterMode === 'all'
      ? 'input,textarea,button,select,a[href],[role],[contenteditable="true"],img[alt],h1,h2,h3,h4,h5,h6,p,li,td,th,label,span,div'
      : INTERACTIVE_SELECTOR;

    const elements = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .slice(0, 80);

    const lines = [];
    for (const el of elements) {
      const id = ++window.__agentlimbRefCounter;
      window.__agentlimbElementMap[id] = new WeakRef(el);
      lines.push(buildTreeLine(el, id));
    }
    return { tree: lines.join('\n'), count: lines.length };
  }

  function buildTreeLine(el, refId) {
    const role = getRole(el);
    const label = getLabel(el);
    let line = `${role} "${label}" [ref_${refId}]`;

    if (el.dataset?.testid) line += ` testid="${el.dataset.testid}"`;
    if (el.id) line += ` id="${el.id}"`;
    if (el.name) line += ` name="${el.name}"`;
    if (el.type && el.tagName === 'INPUT') line += ` type="${el.type}"`;
    if (el.tagName === 'SELECT') {
      const opts = Array.from(el.options).slice(0, 8).map(o => o.text.trim());
      if (opts.length) line += ` options=[${opts.join(',')}]`;
    }
    if (el.disabled) line += ' disabled';
    if (el.type === 'checkbox' || el.type === 'radio') line += ` checked=${el.checked}`;
    return line;
  }

  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const map = {
      button: 'button', a: 'link', input: 'input', textarea: 'textbox',
      select: 'combobox', img: 'img', h1: 'heading', h2: 'heading',
      h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
      p: 'paragraph', li: 'listitem', td: 'cell', th: 'columnheader', label: 'label',
    };
    if (el.isContentEditable) return 'textbox';
    return map[tag] || tag;
  }

  function getLabel(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').slice(0, 60);
    if (el.placeholder) return el.placeholder.slice(0, 60);
    if (el.title) return el.title.slice(0, 60);
    if (el.alt) return el.alt.slice(0, 60);
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent.trim().slice(0, 60);
    }
    // 真实表单常见：input 只有 name 没有 label，用 name 兜底
    if (el.name) return el.name.slice(0, 60);
    const text = el.textContent?.trim().slice(0, 60);
    if (text) return text;
    return '';
  }

  function getBestSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.dataset?.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
    if (el.getAttribute('aria-label')) return `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;
    if (el.name && document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`).length === 1) {
      return `[name="${CSS.escape(el.name)}"]`;
    }
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
      if (classes && document.querySelectorAll(classes).length === 1) return classes;
    }
    return null;
  }

  function getTargetInfo(el) {
    const targetLabel = getLabel(el) || '';
    const targetSelector = getBestSelector(el);
    const targetCandidates = [...new Set([targetLabel, targetSelector].filter(Boolean))];
    return {
      target_label: targetLabel || undefined,
      target_selector: targetSelector || undefined,
      target_candidates: targetCandidates,
    };
  }

  // ── 单步操作 ──────────────────────────

  async function executeAction(action) {
    const { type, ref_id, selector, value } = action;

    let el = null;
    if (ref_id != null) {
      const weakRef = window.__agentlimbElementMap[ref_id];
      el = weakRef?.deref() ?? null;
      if (!el) return { ok: false, error: `ref_${ref_id} expired — call observe again` };
    }
    if (!el && selector) {
      el = findBySelector(selector);
      if (!el) {
        // Fallback for type on hidden inputs (e.g. flair_id) — bypass visibility check
        if (type === 'type') {
          try {
            const raw = document.querySelector(selector);
            if (raw && raw.type === 'hidden') el = raw;
          } catch {}
        }
        if (!el) {
          // 诊断：区分"匹配不到"和"匹配到但不可见"
          let diag = `selector "${selector}" `;
          try {
            const raw = document.querySelector(selector);
            if (raw) diag += `matched but element is not visible (display/size/opacity). Try a different selector or wait for it to appear.`;
            else diag += `matched 0 elements. Check the selector syntax or use observe to find the correct ref_id.`;
          } catch { diag += `is invalid CSS. Check syntax.`; }
          return { ok: false, error: diag };
        }
      }
    }
    // press_key 允许不传 ref_id/selector，默认对 activeElement 发键
    if (!el && type === 'press_key') el = null; // 下面 press_key 分支自行处理 fallback
    else if (!el) return { ok: false, error: `ref_${ref_id ?? '?'} not found — call observe again to get fresh ref_ids` };

    const targetInfo = el ? getTargetInfo(el) : {};

    try {
      if (type === 'click') {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        await delay(200);

        // Occlusion check
        const rect = el.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (topEl && topEl !== el && !el.contains(topEl)) {
          const cs = window.getComputedStyle(topEl);
          const isOverlay = cs.position === 'fixed' || cs.position === 'absolute';
          return { ok: false, error: `Element occluded by <${topEl.tagName.toLowerCase()}>${isOverlay ? ' (overlay)' : ''}. Handle overlay first.` };
        }

        // Checkbox/radio: single click + verify
        if (el.type === 'checkbox' || el.type === 'radio') {
          const before = el.checked;
          el.click();
          await delay(50);
          if (el.checked === before && el.type === 'checkbox') {
            el.checked = !before;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { ok: true, before_checked: before, after_checked: el.checked, ...targetInfo };
        }

        // javascript: href links cause CSP errors in ISOLATED world — detach href before click
        const href = el.tagName === 'A' ? el.getAttribute('href') : null;
        if (href && /^javascript:/i.test(href)) {
          el.removeAttribute('href');
          el.click();
          el.setAttribute('href', href);
        } else {
          el.click();
        }
        return { ok: true, ...targetInfo };
      }

      if (type === 'type') {
        if (el.tagName === 'INPUT' && el.type === 'file') {
          return { ok: false, requires_human: true, error: 'File upload requires user action. Use report({log:"Please select file"}) then wait({selector:...}).' };
        }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        await delay(200);
        await fillElement(el, String(value || ''));
        return { ok: true, ...targetInfo };
      }

      if (type === 'select') {
        if (el.tagName !== 'SELECT') {
          const hint = (el.type === 'radio' || el.type === 'checkbox')
            ? ` Element is a ${el.type} — use act(type:"click") instead.`
            : '';
          return { ok: false, error: `Not a <select> element (got <${el.tagName.toLowerCase()}>).${hint}` };
        }
        const targetValue = String(value || '');
        const opt = Array.from(el.options).find(o => o.value === targetValue || o.text.trim().toLowerCase() === targetValue.toLowerCase());
        if (!opt) return { ok: false, error: `Option not found: "${targetValue}"` };
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, ...targetInfo };
      }

      if (type === 'press_key') {
        const key = (value || 'Enter').trim();
        const keyMap = {
          Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
          Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
          Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
          Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
          ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
          ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
          Space: { key: ' ', code: 'Space', keyCode: 32 },
        };
        const info = keyMap[key] || { key, code: key, keyCode: 0 };
        const dispatchTarget = el || document.activeElement || document.body;
        const opts = { key: info.key, code: info.code, keyCode: info.keyCode, bubbles: true, cancelable: true };
        dispatchTarget.dispatchEvent(new KeyboardEvent('keydown', opts));
        dispatchTarget.dispatchEvent(new KeyboardEvent('keypress', opts));
        dispatchTarget.dispatchEvent(new KeyboardEvent('keyup', opts));
        // Enter on form element → also trigger submit
        if (key === 'Enter' && dispatchTarget.form) {
          dispatchTarget.form.requestSubmit ? dispatchTarget.form.requestSubmit() : dispatchTarget.form.submit();
        }
        return { ok: true, key: info.key, ...targetInfo };
      }

      return { ok: false, error: `Unknown action type: ${type}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function findBySelector(selector) {
    for (const sel of selector.split(',').map(s => s.trim()).filter(Boolean)) {
      try { const el = document.querySelector(sel); if (el && isVisible(el)) return el; } catch {}
    }
    try { const el = document.querySelector(selector); if (el && isVisible(el)) return el; } catch {}

    // Fallback: data-testid, observe label, button text, aria-label
    if (!selector.startsWith('[') && !selector.startsWith('#') && !selector.startsWith('.')) {
      try { const el = document.querySelector(`[data-testid="${selector}"]`); if (el && isVisible(el)) return el; } catch {}
      const needle = selector.trim().toLowerCase();
      const interactiveEls = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(isVisible);
      for (const el of interactiveEls) {
        if (getLabel(el).trim().toLowerCase() === needle) return el;
      }
      for (const btn of document.querySelectorAll('button, [role="button"]')) {
        if (btn.textContent.trim().toLowerCase() === selector.toLowerCase() && isVisible(btn)) return btn;
      }
      for (const el of document.querySelectorAll('[aria-label]')) {
        if (el.getAttribute('aria-label')?.toLowerCase().includes(selector.toLowerCase()) && isVisible(el)) return el;
      }
      for (const el of interactiveEls) {
        if (getLabel(el).trim().toLowerCase().includes(needle)) return el;
      }
    }
    return null;
  }

  // ── DOM fill ──────────────────────────

  async function fillElement(el, value) {
    if (el.isContentEditable) {
      // Fallback only: service-worker MAIN world handles contenteditable primarily
      if (el.dataset.agentlimbCeFilled === 'true' && el.innerText.trim()) return;
      el.innerHTML = '';
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      el.innerHTML = value.split('\n').map(esc).join('<br>');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    } else {
      // input/textarea: native setter for React/Vue compatibility
      const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (nativeSetter?.set) nativeSetter.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

})();
