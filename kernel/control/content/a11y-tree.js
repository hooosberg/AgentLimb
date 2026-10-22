/**
 * AgentLimb a11y-tree content script
 *
 * Injected at document_start on every frame (manifest content_scripts).
 * Builds a stable element-ref map and an accessibility-style tree on demand.
 * Modeled on a reference accessibility-tree injector:
 *   - refs assigned lazily and cached in a WeakMap (survive re-snapshots)
 *   - password/secret fields redacted
 *   - same-origin iframes and open shadow roots are walked with offsets
 *   - invisible elements pruned in "interactive" mode
 *
 * The SW always talks to frameId 0; frames are addressed explicitly.
 */
(function () {
  if (window.__agentlimbAX) return;

  const MAX_NODES = 5000; // hard scan budget per tree build
  const MAX_TEXT = 80; // accessible-name truncation
  const MAX_DEPTH = 15;
  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option',
  ]);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listbox',
    'slider', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'searchbox', 'spinbutton', 'treeitem', 'dialog',
  ]);
  const REDACT_AUTOCOMPLETE = [
    'current-password', 'new-password', 'one-time-code',
    'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
  ];

  const state = {
    refCounter: 0,
    elementMap: Object.create(null), // ref -> {el, frameOffset}
    reverseMap: new WeakMap(), // el -> ref
  };
  window.__agentlimbAX = state;

  // ── role & name ────────────────────────────────────────────────────────────
  function roleOf(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      return 'textbox';
    }
    return {
      a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
      h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
      img: 'image', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
      section: 'region', article: 'article', aside: 'complementary', form: 'form',
      table: 'table', ul: 'list', ol: 'list', li: 'listitem', iframe: 'document',
    }[tag] || 'generic';
  }

  function isSensitive(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return REDACT_AUTOCOMPLETE.some((k) => ac.includes(k));
  }

  function directText(el) {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      try {
        const lbl = el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) {
          const t = directText(lbl);
          if (t) return t;
        }
      } catch (_) { /* invalid id selector */ }
    }
    const wrapping = el.closest && el.closest('label');
    if (wrapping) {
      const t = directText(wrapping);
      if (t) return t;
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    return '';
  }

  function accessibleName(el) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const parts = labelledby.split(/\s+/).map((id) => {
        try {
          const target = el.getRootNode().getElementById(id);
          return target ? directText(target) : '';
        } catch (_) { return ''; }
      });
      const joined = parts.filter(Boolean).join(' ').trim();
      if (joined) return joined;
    }
    const lbl = labelFor(el);
    if (lbl) return lbl;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') {
      const v = el.value || '';
      if (v) return isSensitive(el) ? '[redacted]' : `value: ${v.slice(0, MAX_TEXT)}`;
    }
    if (tag === 'select') {
      const opt = el.options && el.options[el.selectedIndex];
      if (opt) return opt.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    }
    if (tag === 'img') return '';
    const own = directText(el);
    if (own) return own.slice(0, MAX_TEXT);
    return '';
  }

  // ── refs ───────────────────────────────────────────────────────────────────
  function refFor(el, frameOffset) {
    let ref = state.reverseMap.get(el);
    if (ref == null) {
      ref = ++state.refCounter;
      state.reverseMap.set(el, ref);
      state.elementMap[ref] = { el, frameOffset: frameOffset || { x: 0, y: 0 } };
    }
    return ref;
  }

  // ── visibility ─────────────────────────────────────────────────────────────
  function isHidden(el) {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      // Zero-size elements can still be meaningful (e.g. <br>, script, style).
      if (!INTERACTIVE_TAGS.has(tag)) return true;
    }
    return false;
  }

  function isInteractive(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (INTERACTIVE_TAGS.has(tag)) {
      if (tag === 'label' || tag === 'option') return true;
      if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
      return true;
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (INTERACTIVE_ROLES.has(role)) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    return false;
  }

  // ── tree build ─────────────────────────────────────────────────────────────
  /**
   * @returns {{ok:boolean, tree:string, count:number, refs:number[], error?:string}}
   */
  function buildTree(options = {}) {
    const filter = options.filter === 'all' ? 'all' : 'interactive';
    const maxDepth = Math.min(Number(options.depth) || MAX_DEPTH, 30);
    const limit = Math.min(Number(options.limit) || 100, 300);
    const lines = [];
    const refs = [];
    let budget = MAX_NODES;
    let truncated = false;

    function walkContainer(container, depth, frameOffset) {
      if (depth > maxDepth) return;
      for (const node of Array.from(container.children || [])) {
        if (budget-- <= 0) { truncated = true; return; }
        walkElement(node, depth, frameOffset);
      }
    }

    function walkElement(el, depth, frameOffset) {
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return;

      // Same-origin iframe: walk its document with accumulated offset.
      if (tag === 'iframe') {
        let doc = null;
        try { doc = el.contentDocument; } catch (_) { doc = null; }
        if (doc && doc.documentElement) {
          const rect = el.getBoundingClientRect();
          const childOffset = {
            x: (frameOffset ? frameOffset.x : 0) + rect.left,
            y: (frameOffset ? frameOffset.y : 0) + rect.top,
          };
          lines.push(`${'  '.repeat(depth)}- iframe (same-origin)`);
          walkContainer(doc.documentElement, depth + 1, childOffset);
        } else {
          lines.push(`${'  '.repeat(depth)}- iframe (cross-origin, url: ${(el.src || '').slice(0, 120)})`);
        }
        return;
      }

      const hidden = isHidden(el);
      const interactive = !hidden && isInteractive(el);

      if (filter === 'interactive' && !interactive) {
        // Still descend — interactive elements may live inside plain containers.
        walkContainer(el, depth, frameOffset);
        return;
      }
      if (hidden) return;

      const ref = refFor(el, frameOffset);
      const role = roleOf(el);
      const name = accessibleName(el);
      refs.push(ref);

      const attrs = [];
      if (el.href && tag === 'a') attrs.push(`href=${shorten(el.href)}`);
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        attrs.push(`type=${type}`);
        if (isSensitive(el)) attrs.push('value=[redacted]');
        else if (el.value) attrs.push(`value="${escapeAttr(el.value.slice(0, 40))}"`);
        if (el.checked) attrs.push('checked');
      }
      if (tag === 'select') attrs.push(`value="${escapeAttr(el.value)}"`);
      if (el.disabled) attrs.push('disabled');

      let line = `${'  '.repeat(depth)}- ref=${ref} ${role}`;
      if (name) line += ` "${escapeAttr(name)}"`;
      if (attrs.length) line += ` [${attrs.join(', ')}]`;
      lines.push(line);

      if (refs.length >= limit) { truncated = true; return; }
      walkContainer(el, depth + 1, frameOffset);
    }

    try {
      const root = document.body || document.documentElement;
      if (!root) return { ok: false, error: 'document has no root element yet' };
      walkContainer(root, 0, { x: 0, y: 0 });
      return {
        ok: true,
        tree: lines.join('\n') || '(no interactive elements found)',
        count: refs.length,
        refs,
        truncated,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function shorten(url) {
    try {
      const u = new URL(url, document.baseURI);
      return (u.pathname + u.search).slice(0, 60) || '/';
    } catch (_) {
      return String(url).slice(0, 60);
    }
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, "'").replace(/\n/g, ' ').slice(0, MAX_TEXT);
  }

  // ── find ───────────────────────────────────────────────────────────────────
  function findElements(options = {}) {
    const limit = Math.min(Number(options.limit) || 20, 50);
    const matches = [];
    let candidates = [];
    if (options.selector) {
      try {
        candidates = Array.from(document.querySelectorAll(options.selector));
      } catch (error) {
        return { ok: false, error: `bad selector: ${error.message}` };
      }
    } else if (options.query) {
      const q = String(options.query).toLowerCase();
      candidates = Array.from(document.querySelectorAll('body *')).filter((el) => {
        if (isHidden(el)) return false;
        return directText(el).toLowerCase().includes(q)
          || (el.value && String(el.value).toLowerCase().includes(q))
          || (el.getAttribute('aria-label') || '').toLowerCase().includes(q)
          || (el.getAttribute('placeholder') || '').toLowerCase().includes(q);
      });
    } else {
      return { ok: false, error: 'find requires query or selector' };
    }

    for (const el of candidates) {
      if (matches.length >= limit) break;
      if (isHidden(el)) continue;
      const ref = refFor(el, { x: 0, y: 0 });
      const rect = el.getBoundingClientRect();
      matches.push({
        ref,
        role: roleOf(el),
        name: accessibleName(el),
        tag: el.tagName.toLowerCase(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      });
    }
    return { ok: true, matches, count: matches.length };
  }

  // ── ref resolution ─────────────────────────────────────────────────────────
  async function resolveRef(ref) {
    const entry = state.elementMap[ref];
    if (!entry) return { ok: false, error: `unknown ref ${ref} — call read_page/find again` };
    const { el, frameOffset } = entry;
    if (!el.isConnected) return { ok: false, error: 'element is no longer in the document' };
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return { ok: false, error: 'element has zero size (hidden?)' };
    }
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2 + (frameOffset ? frameOffset.x : 0)),
      y: Math.round(rect.top + rect.height / 2 + (frameOffset ? frameOffset.y : 0)),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      tag: el.tagName.toLowerCase(),
      name: accessibleName(el),
    };
  }

  // ── selector resolution ────────────────────────────────────────────────────
  // Same contract as resolveRef: scroll the target into view FIRST, then report
  // viewport coordinates. Without the scroll, elements below the fold produced
  // coordinates outside the viewport and the click silently landed on <html>.
  async function resolveSelector(selector) {
    let el;
    try {
      el = document.querySelector(selector);
    } catch (error) {
      return { ok: false, error: `bad selector: ${error.message}` };
    }
    if (!el) return { ok: false, error: `selector not found: ${selector}` };
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return { ok: false, error: 'element has zero size (hidden?)' };
    }
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      tag: el.tagName.toLowerCase(),
      name: accessibleName(el),
    };
  }

  // ── form input ─────────────────────────────────────────────────────────────
  async function formInput(options = {}) {
    let el = null;
    if (options.ref != null) {
      const entry = state.elementMap[options.ref];
      if (!entry) return { ok: false, error: `unknown ref ${options.ref}` };
      el = entry.el;
    } else if (options.selector) {
      el = document.querySelector(options.selector);
    }
    if (!el) return { ok: false, error: 'element not found' };
    if (!el.isConnected) return { ok: false, error: 'element detached' };

    const tag = el.tagName.toLowerCase();
    const value = options.value;

    if (tag === 'select') {
      const opt = Array.from(el.options).find((o) => o.value === String(value) || o.textContent.trim() === String(value));
      if (!opt) return { ok: false, error: `option not found: ${value}` };
      el.value = opt.value;
      fire(el, 'change');
      fire(el, 'input');
      return { ok: true, value: el.value, selectedText: opt.textContent.trim() };
    }
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = Boolean(value);
      fire(el, 'change');
      fire(el, 'input');
      return { ok: true, checked: el.checked };
    }
    if (el.isContentEditable) {
      el.textContent = String(value);
      fire(el, 'input');
      return { ok: true, value: el.textContent };
    }
    // text-like inputs & textarea
    el.focus();
    el.value = String(value);
    fire(el, 'input');
    fire(el, 'change');
    return { ok: true, value: el.value };
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }

  // ── wait ───────────────────────────────────────────────────────────────────
  function waitFor(options = {}) {
    const timeout = Math.min(Number(options.timeout) || 10000, 30000);
    const condition = options.condition
      || (options.selector ? 'visible' : 'page_load');
    const started = Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve({ ok: false, error: `timeout after ${timeout}ms waiting for ${condition}` });
      }, timeout);

      const observer = new MutationObserver(check);
      function check() {
        let satisfied = false;
        try {
          switch (condition) {
            case 'visible':
              satisfied = options.selector
                ? !!document.querySelector(options.selector) && isVisibleNow(document.querySelector(options.selector))
                : document.readyState === 'complete';
              break;
            case 'hidden':
              satisfied = options.selector ? !document.querySelector(options.selector) : false;
              break;
            case 'exists':
              satisfied = options.selector ? !!document.querySelector(options.selector) : false;
              break;
            case 'url_contains':
              satisfied = location.href.includes(options.text || '');
              break;
            case 'page_contains':
              satisfied = (document.body?.innerText || '').includes(options.text || '');
              break;
            case 'page_load':
              satisfied = document.readyState === 'complete';
              break;
            default:
              satisfied = false;
          }
        } catch (_) { satisfied = false; }

        if (satisfied || Date.now() - started >= timeout) {
          clearTimeout(timer);
          observer.disconnect();
          resolve({ ok: satisfied, condition, waitedMs: Date.now() - started });
        }
      }
      function isVisibleNow(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      observer.observe(document, { subtree: true, childList: true, attributes: true });
      check();
    });
  }

  // ── message router ──────────────────────────────────────────────────────────
  let handler = null;
  if (window.__agentlimbAXHandler) {
    chrome.runtime.onMessage.removeListener(window.__agentlimbAXHandler);
  }
  handler = function (message, _sender, sendResponse) {
    Promise.resolve()
      .then(async () => {
        switch (message && message.type) {
          case 'AGENTLIMB_PING':
            return { ok: true, pong: true, frame: 'ax' };
          case 'AGENTLIMB_READ_PAGE':
            return buildTree(message.options || {});
          case 'AGENTLIMB_FIND':
            return findElements(message.options || {});
          case 'AGENTLIMB_RESOLVE_REF':
            return resolveRef(message.ref);
          case 'AGENTLIMB_RESOLVE_SELECTOR':
            return resolveSelector(message.selector);
          case 'AGENTLIMB_FORM_INPUT':
            return formInput(message.options || {});
          case 'AGENTLIMB_WAIT':
            return waitFor(message.options || {});
          default:
            return { ok: false, error: `unknown ax message: ${message && message.type}` };
        }
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };
  window.__agentlimbAXHandler = handler;
  chrome.runtime.onMessage.addListener(handler);
})();
