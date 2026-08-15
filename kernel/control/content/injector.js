(function () {
  // Persist state across re-injections (e.g. after MV3 service worker restart).
  // Storing on window means elementMap survives re-injection without losing refs.
  if (!window.__agentlimbState) {
    window.__agentlimbState = {
      refCounter: 0,
      elementMap: Object.create(null),
    };
  }
  const state = window.__agentlimbState;

  // Re-register the message listener on every injection.
  // This handles the MV3 case where the SW restarts: the old listener's port
  // is dead, PING times out, injectScript is called again, and we need a fresh
  // listener bound to the new SW context. Remove the old handler first to
  // prevent duplicate responses.
  if (window.__agentlimbMessageHandler) {
    chrome.runtime.onMessage.removeListener(window.__agentlimbMessageHandler);
  }
  window.__agentlimbMessageHandler = function (message, _sender, sendResponse) {
    Promise.resolve(handleMessage(message))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };
  chrome.runtime.onMessage.addListener(window.__agentlimbMessageHandler);

  async function handleMessage(message = {}) {
    switch (message.type) {
      case 'AGENTLIMB_PING':
        return { ok: true, pong: true };
      case 'AGENTLIMB_GET_PAGE_CONTEXT':
        return { ok: true, page: getPageContext() };
      case 'AGENTLIMB_GET_PAGE_SNAPSHOT':
        return getPageSnapshot(message.filterMode, message.limit);
      case 'AGENTLIMB_RESOLVE_TARGET':
        return resolveTarget(message.target || {});
      case 'AGENTLIMB_FORM_INPUT':
        return executeFormInput(message);
      case 'AGENTLIMB_WAIT_FOR':
        return executeWaitFor(message);
      default:
        return {
          ok: false,
          error: `Unknown page message: ${message.type || '(empty)'}`,
        };
    }
  }

  function executeWaitFor(message = {}) {
    const selector = message.selector;
    const condition = message.condition || 'visible';
    const timeout = Math.min(Math.max(Number(message.timeout) || 10000, 1000), 30000);

    if (!selector) {
      return Promise.resolve({ ok: false, error: 'wait requires a selector.' });
    }

    return new Promise((resolve) => {
      const startTime = Date.now();

      function checkCondition() {
        const element = document.querySelector(selector);
        switch (condition) {
          case 'visible':
            return element && isVisible(element);
          case 'hidden':
            return !element || !isVisible(element);
          case 'exists':
            return !!element;
          case 'page_contains':
            return (document.body?.textContent || '').includes(selector);
          default:
            return false;
        }
      }

      if (checkCondition()) {
        resolve({ ok: true, waited: true, durationMs: Date.now() - startTime, matched: true });
        return;
      }

      const observer = new MutationObserver(() => {
        if (checkCondition()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ ok: true, waited: true, durationMs: Date.now() - startTime, matched: true });
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve({ ok: false, error: 'Timeout waiting for element.', durationMs: Date.now() - startTime });
      }, timeout);
    });
  }

  async function executeFormInput(message = {}) {
    const target = message.target || {};
    const value = message.value;

    const refId = normalizeRefId(target.refId ?? target.ref_id);
    let element = null;

    if (refId != null) {
      element = state.elementMap[refId] ?? null;
    }
    if (!element && target.selector) {
      element = findBySelector(target.selector);
    }
    if (!element) {
      return { ok: false, error: 'Cannot resolve form target. Capture a fresh snapshot.' };
    }

    element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    element.focus({ preventScroll: true });

    const tag = element.tagName.toLowerCase();

    // <select>
    if (tag === 'select') {
      const options = Array.from(element.options);
      const match = options.find(
        (opt) => opt.value === String(value) || opt.textContent.trim() === String(value),
      );
      if (!match) {
        return { ok: false, error: `No matching option for value "${value}". Options: ${options.map((o) => o.textContent.trim()).join(', ')}` };
      }
      element.value = match.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: 'select', selectedValue: match.value, selectedText: match.textContent.trim() };
    }

    // checkbox / radio
    if (tag === 'input' && (element.type === 'checkbox' || element.type === 'radio')) {
      let checked;
      if (typeof value === 'boolean') {
        checked = value;
      } else if (value === 'false' || value === 'off' || value === '0' || value === 'no') {
        checked = false;
      } else {
        // "true", "on", checkbox value attribute (e.g. "bacon"), or any truthy string → check
        checked = true;
      }
      element.checked = checked;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: element.type, checked };
    }

    // contenteditable
    if (element.isContentEditable) {
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, String(value));
      return { ok: true, action: 'contenteditable', length: String(value).length };
    }

    // regular input / textarea
    if (tag === 'input' || tag === 'textarea') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(element, String(value));
      } else {
        element.value = String(value);
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, action: 'input', length: String(value).length };
    }

    return { ok: false, error: `Unsupported form element: <${tag}>` };
  }

  function getPageSnapshot(filterMode = 'interactive', limit = 60) {
    const candidates = collectSnapshotCandidates(filterMode, limit);
    state.elementMap = Object.create(null);

    const nodes = candidates.map((element) => {
      const refId = ++state.refCounter;
      state.elementMap[refId] = element;
      return describeElement(element, refId);
    });

    return {
      ok: true,
      page: getPageContext(),
      count: nodes.length,
      tree: nodes.map(formatTreeLine).join('\n'),
      nodes,
    };
  }

  async function resolveTarget(target = {}) {
    const refId = normalizeRefId(target.refId ?? target.ref_id);
    let element = null;

    if (refId != null) {
      element = state.elementMap[refId] ?? null;
    }

    if (!element && target.selector) {
      element = findBySelector(target.selector);
    }

    if (!element) {
      const knownRefs = Object.keys(state.elementMap).map(Number);
      const mapSize = knownRefs.length;
      const navHint = mapSize === 0
        ? ' Page may have navigated (e.g. form submitted, link opened) — refIds are now stale.'
        : ` Valid refs: ${knownRefs.slice(0, 10).join(',')}.`;
      return {
        ok: false,
        error: `Stale refId: refId=${refId}, selector=${target.selector || '(none)'}. elementMap has ${mapSize} entries.${navHint} Call page_snapshot to get fresh refIds. Current URL: ${location.href}`,
      };
    }

    if (target.scrollIntoView !== false) {
      element.scrollIntoView({
        behavior: 'instant',
        block: target.block || 'center',
        inline: 'center',
      });
    }

    if (target.focus) {
      element.focus({ preventScroll: true });
    }

    const descriptor = describeElement(element, refId);
    return {
      ok: true,
      target: descriptor,
      coordinate: descriptor.center,
      rect: descriptor.rect,
    };
  }

  function getPageContext() {
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
      },
      selectionText: String(window.getSelection?.()?.toString() || '').slice(0, 240),
    };
  }

  function collectSnapshotCandidates(filterMode, limit) {
    const selector = filterMode === 'all' ? ALL_SELECTOR : INTERACTIVE_SELECTOR;
    const elements = Array.from(document.querySelectorAll(selector));

    return dedupeElements(
      elements.filter((element) => isSnapshotCandidate(element, filterMode)).slice(0, sanitizeLimit(limit)),
    );
  }

  function describeElement(element, refId = null) {
    const rect = element.getBoundingClientRect();
    const safeRect = {
      x: round(rect.left),
      y: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    };

    return {
      refId,
      role: getRole(element),
      label: getLabel(element),
      selector: getBestSelector(element),
      tagName: element.tagName.toLowerCase(),
      text: getVisibleText(element),
      isContentEditable: Boolean(element.isContentEditable),
      inputType: element.tagName === 'INPUT' ? element.type || 'text' : null,
      rect: safeRect,
      center: {
        x: round(rect.left + rect.width / 2),
        y: round(rect.top + rect.height / 2),
      },
    };
  }

  function formatTreeLine(node) {
    const label = node.label ? `"${node.label}"` : '""';
    const selector = node.selector ? ` selector="${node.selector}"` : '';
    return `${node.role} ${label} [ref_${node.refId}] center=(${node.center.x},${node.center.y})${selector}`;
  }

  function getRole(element) {
    if (element.getAttribute('role')) return element.getAttribute('role');
    if (element.isContentEditable) return 'textbox';

    const tag = element.tagName.toLowerCase();
    const roleMap = {
      a: 'link',
      button: 'button',
      input: 'input',
      textarea: 'textbox',
      select: 'combobox',
      img: 'image',
    };

    return roleMap[tag] || tag;
  }

  function getLabel(element) {
    const directLabel =
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      element.getAttribute('placeholder');

    if (directLabel) return directLabel.trim().slice(0, 100);

    if (element.id) {
      const linkedLabel = document.querySelector(`label[for="${escapeSelector(element.id)}"]`);
      if (linkedLabel?.textContent?.trim()) {
        return linkedLabel.textContent.trim().slice(0, 100);
      }
    }

    if (element.name) return element.name.trim().slice(0, 100);

    return getVisibleText(element, 100);
  }

  function getVisibleText(element, maxLength = 120) {
    return String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function getBestSelector(element) {
    if (element.id) return `#${escapeSelector(element.id)}`;

    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeSelector(testId)}"]`;

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${escapeSelector(ariaLabel)}"]`;

    if (element.name) {
      const byName = `[name="${escapeSelector(element.name)}"]`;
      if (document.querySelectorAll(byName).length === 1) return byName;
    }

    const text = getVisibleText(element, 40);
    if (text && element.tagName === 'BUTTON') {
      return `button:text("${text}")`;
    }

    return null;
  }

  function isSnapshotCandidate(element, filterMode = 'interactive') {
    if (!(element instanceof HTMLElement)) return false;
    if (!isVisible(element)) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    // In 'all' mode, include elements below/right of the viewport (e.g. dynamically loaded content
    // that has appeared in the DOM but is not currently scrolled into view).
    if (filterMode !== 'all' && (rect.top > window.innerHeight || rect.left > window.innerWidth)) return false;

    return true;
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function dedupeElements(elements) {
    const seen = new Set();
    const result = [];

    for (const element of elements) {
      const key = `${element.tagName}:${getLabel(element)}:${getBestSelector(element) || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(element);
    }

    return result;
  }

  function findBySelector(selector) {
    if (!selector) return null;

    if (/^[a-z]+:text\("/i.test(selector)) {
      const match = selector.match(/^([a-z0-9_-]+):text\("(.+)"\)$/i);
      if (!match) return null;
      const [, tagName, text] = match;
      return Array.from(document.querySelectorAll(tagName)).find((element) =>
        getVisibleText(element, 200) === text,
      );
    }

    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function sanitizeLimit(limit) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) return 60;
    return Math.max(10, Math.min(120, Math.round(parsed)));
  }

  function normalizeRefId(refId) {
    if (typeof refId === 'string' && /^ref_\d+$/i.test(refId)) {
      return Number(refId.replace(/^ref_/i, ''));
    }

    const parsed = Number(refId);
    return Number.isInteger(parsed) ? parsed : null;
  }

  function escapeSelector(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function round(value) {
    return Math.round(Number(value) || 0);
  }

  function waitForLayout() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 30);
      });
    });
  }

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[contenteditable="true"]',
  ].join(',');

  const ALL_SELECTOR = [
    INTERACTIVE_SELECTOR,
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'img[alt]',
    '[role]',
  ].join(',');
})();
