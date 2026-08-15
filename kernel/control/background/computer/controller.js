import { describeTab, getTargetTab, delay } from '../runtime/browser.js';
import { withDebuggerSession } from '../runtime/debugger.js';

const DEFAULT_SCROLL_DELTA_Y = 720;

export function createComputerController({ permissions, snapshot }) {
  let lastAction = null;

  return {
    async getStatus() {
      return {
        ready: true,
        executionModel: 'cdp-first-minimum-viable',
        referencePriority: 'reference-claude-chrome-ext',
        supportedActions: ['click', 'double_click', 'right_click', 'type', 'scroll', 'screenshot', 'key', 'hover', 'drag'],
        lastAction,
        dependencies: {
          permissions: permissions.getStatus().ready,
          snapshot: (await snapshot.getStatus()).ready,
        },
      };
    },

    async executeAction(action = {}) {
      const normalizedAction = normalizeAction(action);

      if (!normalizedAction.type) {
        return { ok: false, error: 'Computer action requires a type field.' };
      }

      let result;
      switch (normalizedAction.type) {
        case 'click':
          result = await executeClick(normalizedAction, snapshot);
          break;
        case 'double_click':
          result = await executeDoubleClick(normalizedAction, snapshot);
          break;
        case 'right_click':
          result = await executeRightClick(normalizedAction, snapshot);
          break;
        case 'hover':
          result = await executeHover(normalizedAction, snapshot);
          break;
        case 'drag':
          result = await executeDrag(normalizedAction, snapshot);
          break;
        case 'type':
          result = await executeType(normalizedAction, snapshot);
          break;
        case 'scroll':
          result = await executeScroll(normalizedAction, snapshot);
          break;
        case 'screenshot':
          result = await executeScreenshot(normalizedAction);
          break;
        case 'key':
          result = await executeKey(normalizedAction);
          break;
        default:
          result = {
            ok: false,
            error: `Unsupported computer action: ${normalizedAction.type}`,
          };
      }

      lastAction = {
        type: normalizedAction.type,
        ok: result.ok,
        at: new Date().toISOString(),
      };

      return result;
    },
  };
}

async function executeClick(action, snapshot) {
  const target = await resolveActionCoordinate(action, snapshot);
  if (!target.ok) return target;

  // Snapshot existing tab IDs before click so we can detect new-tab navigation
  const tabsBefore = await chrome.tabs.query({});
  const tabIdsBefore = new Set(tabsBefore.map((t) => t.id));

  await withDebuggerSession(target.tab.id, async ({ sendCommand }) => {
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: 'none',
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: action.button,
      clickCount: 1,
    });
    await delay(35);
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: action.button,
      clickCount: 1,
    });
  });

  const freshTab = await waitForTabUrlChangeOrNewTab(target.tab.id, target.tab.url, tabIdsBefore);

  return {
    ok: true,
    action: 'click',
    via: 'cdp',
    tab: describeTab(freshTab),
    coordinate: target.coordinate,
    target: target.target ?? null,
  };
}

async function executeDoubleClick(action, snapshot) {
  const target = await resolveActionCoordinate(action, snapshot);
  if (!target.ok) return target;

  await withDebuggerSession(target.tab.id, async ({ sendCommand }) => {
    const { x, y } = target.coordinate;
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none',
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
    await delay(35);
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 2,
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 2,
    });
  });

  return {
    ok: true, action: 'double_click', via: 'cdp',
    tab: describeTab(target.tab),
    coordinate: target.coordinate,
    target: target.target ?? null,
  };
}

async function executeRightClick(action, snapshot) {
  const target = await resolveActionCoordinate(action, snapshot);
  if (!target.ok) return target;

  await withDebuggerSession(target.tab.id, async ({ sendCommand }) => {
    const { x, y } = target.coordinate;
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none',
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'right', clickCount: 1,
    });
    await delay(35);
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'right', clickCount: 1,
    });
  });

  return {
    ok: true, action: 'right_click', via: 'cdp',
    tab: describeTab(target.tab),
    coordinate: target.coordinate,
    target: target.target ?? null,
  };
}

async function executeHover(action, snapshot) {
  const target = await resolveActionCoordinate(action, snapshot);
  if (!target.ok) return target;

  await withDebuggerSession(target.tab.id, async ({ sendCommand }) => {
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: 'none',
    });
  });

  await delay(100);

  return {
    ok: true, action: 'hover', via: 'cdp',
    tab: describeTab(target.tab),
    coordinate: target.coordinate,
    target: target.target ?? null,
  };
}

async function executeDrag(action, snapshot) {
  const tab = await getTargetTab(action.tabId);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for drag action.' };
  }

  // Resolve start coordinate
  let startCoord;
  if (Number.isFinite(Number(action.startX)) && Number.isFinite(Number(action.startY))) {
    startCoord = { x: Math.round(Number(action.startX)), y: Math.round(Number(action.startY)) };
  } else if (action.startRefId != null) {
    const resolved = await snapshot.resolveActionTarget({ refId: action.startRefId, tabId: tab.id });
    if (!resolved.ok) return { ok: false, error: `Cannot resolve drag start: ${resolved.error}` };
    startCoord = resolved.coordinate;
  } else {
    return { ok: false, error: 'Drag requires startX/startY or startRefId for the start position.' };
  }

  // Resolve end coordinate
  const endTarget = await resolveActionCoordinate(action, snapshot);
  if (!endTarget.ok) return endTarget;
  const endCoord = endTarget.coordinate;

  const steps = 10;
  await withDebuggerSession(tab.id, async ({ sendCommand }) => {
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: startCoord.x, y: startCoord.y, button: 'none',
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: startCoord.x, y: startCoord.y, button: 'left', clickCount: 1,
    });
    await delay(50);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mx = Math.round(startCoord.x + (endCoord.x - startCoord.x) * t);
      const my = Math.round(startCoord.y + (endCoord.y - startCoord.y) * t);
      await sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: mx, y: my, button: 'left',
      });
      await delay(15);
    }

    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: endCoord.x, y: endCoord.y, button: 'left', clickCount: 1,
    });
  });

  return {
    ok: true, action: 'drag', via: 'cdp',
    tab: describeTab(tab),
    start: startCoord,
    end: endCoord,
    target: endTarget.target ?? null,
  };
}

async function executeType(action, snapshot) {
  const text = action.text ?? action.value;
  if (typeof text !== 'string') {
    return { ok: false, error: 'Type action requires a text or value string.' };
  }

  // No target specified → type into currently focused element (like computer.key)
  const hasTarget = action.refId != null || action.ref_id != null || action.selector ||
    (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y)));

  if (!hasTarget) {
    const tab = await getTargetTab(action.tabId);
    if (!tab?.id) {
      return { ok: false, error: 'No active tab available for type action.' };
    }
    // Brief wait so a preceding click's focus event can settle before we type.
    // Without this, parallel or back-to-back click+type may insert into the
    // wrong element (or nothing) because CDP focus is asynchronous.
    await delay(80);
    await withDebuggerSession(tab.id, async ({ sendCommand }) => {
      await sendCommand('Input.insertText', { text });
    });
    return {
      ok: true,
      action: 'type',
      via: 'cdp_insertText_focused',
      tab: describeTab(tab),
      coordinate: null,
      target: null,
      textLength: text.length,
    };
  }

  const target = await resolveActionCoordinate(action, snapshot);
  if (!target.ok) return target;

  await withDebuggerSession(target.tab.id, async ({ sendCommand }) => {
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: 'none',
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: 'left',
      clickCount: 1,
    });
    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: target.coordinate.x,
      y: target.coordinate.y,
      button: 'left',
      clickCount: 1,
    });

    if (action.clearExisting !== false) {
      const selectAllModifier = getSelectAllModifier();

      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers: selectAllModifier,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      });
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: selectAllModifier,
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      });
      await delay(30);

      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
      await delay(30);
    }

    await sendCommand('Input.insertText', { text });
  });

  return {
    ok: true,
    action: 'type',
    via: 'cdp_insertText',
    tab: describeTab(target.tab),
    coordinate: target.coordinate,
    target: target.target ?? null,
    textLength: text.length,
  };
}

async function executeScroll(action, snapshot) {
  const tab = await getTargetTab(action.tabId);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for scroll action.' };
  }

  const target = await resolveScrollTarget(action, snapshot, tab.id);
  if (!target.ok) return target;

  const deltaX = toFiniteNumber(action.deltaX, 0);
  const deltaY = resolveScrollDelta(action);

  // Use Runtime.evaluate with window.scrollBy for reliable scrolling,
  // since CDP mouseWheel events can be ignored by some pages.
  let scrollBefore = null;
  let scrollAfter = null;
  await withDebuggerSession(tab.id, async ({ sendCommand }) => {
    // Capture position before scrolling so we can report whether it actually moved.
    const beforeResult = await sendCommand('Runtime.evaluate', {
      expression: `JSON.stringify({ scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) })`,
      returnByValue: true,
    });
    scrollBefore = beforeResult?.result?.value ? JSON.parse(beforeResult.result.value) : null;

    // If targeting a specific element via ref/selector, try mouseWheel first
    if (target.target) {
      await sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: target.coordinate.x,
        y: target.coordinate.y,
        deltaX,
        deltaY,
        pointerType: 'mouse',
      });
    } else {
      // For viewport-level scrolling, use JS which is more reliable.
      // Use scrollTo with behavior:'instant' to bypass CSS scroll-behavior:smooth,
      // which makes scrollBy() async and causes stale scrollAfter readings.
      await sendCommand('Runtime.evaluate', {
        expression: `window.scrollTo({left: window.scrollX + ${deltaX}, top: window.scrollY + ${deltaY}, behavior: 'instant'})`,
        returnByValue: true,
      });

      // If window didn't scroll (e.g. body has overflow:hidden and the actual
      // scroll container is document.documentElement), retry on documentElement.
      const midCheck = await sendCommand('Runtime.evaluate', {
        expression: `JSON.stringify({ x: Math.round(window.scrollX), y: Math.round(window.scrollY) })`,
        returnByValue: true,
      });
      const mid = midCheck?.result?.value ? JSON.parse(midCheck.result.value) : null;
      if (mid && scrollBefore && mid.x === scrollBefore.scrollX && mid.y === scrollBefore.scrollY) {
        await sendCommand('Runtime.evaluate', {
          expression: `(function(){ var el = document.documentElement; el.scrollTo({left: el.scrollLeft + ${deltaX}, top: el.scrollTop + ${deltaY}, behavior: 'instant'}); })()`,
          returnByValue: true,
        });
      }
    }

    // Read actual scroll position after scrolling
    const scrollResult = await sendCommand('Runtime.evaluate', {
      expression: `JSON.stringify({ scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY), scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight })`,
      returnByValue: true,
    });
    scrollAfter = scrollResult?.result?.value
      ? JSON.parse(scrollResult.result.value)
      : null;
  });

  const moved = scrollBefore && scrollAfter
    ? (scrollAfter.scrollX !== scrollBefore.scrollX || scrollAfter.scrollY !== scrollBefore.scrollY)
    : null;

  return {
    ok: true,
    action: 'scroll',
    via: target.target ? 'cdp_mouseWheel' : 'cdp_scrollBy',
    tab: describeTab(tab),
    coordinate: target.coordinate,
    deltaX,
    deltaY,
    moved,
    scrollAfter,
    target: target.target ?? null,
  };
}

async function executeScreenshot(action) {
  const tab = await getTargetTab(action.tabId);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for screenshot action.' };
  }

  const format = action.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = clampQuality(action.quality);

  try {
    const capture = await withDebuggerSession(tab.id, async ({ sendCommand }) => {
      return sendCommand('Page.captureScreenshot', {
        format,
        quality: format === 'jpeg' ? quality : undefined,
        captureBeyondViewport: Boolean(action.captureBeyondViewport),
      });
    });

    const base64 = capture?.data || '';
    const sizeBytes = Math.round(base64.length * 0.75);

    return {
      ok: true,
      action: 'screenshot',
      via: 'cdp',
      tab: describeTab(tab),
      format,
      sizeBytes,
      sizeKb: Math.round(sizeBytes / 1024),
      data: action.includeData ? base64 : undefined,
    };
  } catch (error) {
    if (!tab.windowId) {
      return { ok: false, error: error.message };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: format === 'jpeg' ? 'jpeg' : 'png',
      quality,
    });
    const base64 = dataUrl.split(',')[1] || '';
    const sizeBytes = Math.round(base64.length * 0.75);

    return {
      ok: true,
      action: 'screenshot',
      via: 'tabs.captureVisibleTab_fallback',
      tab: describeTab(tab),
      format,
      sizeBytes,
      sizeKb: Math.round(sizeBytes / 1024),
      data: action.includeData ? base64 : undefined,
    };
  }
}

const KEY_MAP = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9, text: '\t' },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, key: ' ', text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  F1: { code: 'F1', keyCode: 112 },
  F2: { code: 'F2', keyCode: 113 },
  F3: { code: 'F3', keyCode: 114 },
  F4: { code: 'F4', keyCode: 115 },
  F5: { code: 'F5', keyCode: 116 },
  F6: { code: 'F6', keyCode: 117 },
  F7: { code: 'F7', keyCode: 118 },
  F8: { code: 'F8', keyCode: 119 },
  F9: { code: 'F9', keyCode: 120 },
  F10: { code: 'F10', keyCode: 121 },
  F11: { code: 'F11', keyCode: 122 },
  F12: { code: 'F12', keyCode: 123 },
};

// Poll until the tab URL changes from previousUrl, or a new tab opens (target="_blank").
// Returns the tab that navigated — either the original tab or the newly-opened one.
async function waitForTabUrlChangeOrNewTab(tabId, previousUrl, existingTabIds, maxWaitMs = 1500) {
  const interval = 60;
  const deadline = Date.now() + maxWaitMs;
  await delay(60); // let the navigation intent register
  while (Date.now() < deadline) {
    const tab = await getTargetTab(tabId);
    if (tab && tab.url !== previousUrl) return tab;

    // Also detect links that open in a new tab (target="_blank")
    const allTabs = await chrome.tabs.query({});
    const newTab = allTabs.find(
      (t) => !existingTabIds.has(t.id) && t.url && !t.url.startsWith('chrome://'),
    );
    if (newTab) return newTab;

    await delay(interval);
  }
  return await getTargetTab(tabId) ?? { url: previousUrl };
}

// Keep the old name available for executeKey which only needs same-tab polling.
async function waitForTabUrlChange(tabId, previousUrl, maxWaitMs = 1500) {
  const interval = 60;
  const deadline = Date.now() + maxWaitMs;
  await delay(60);
  while (Date.now() < deadline) {
    const tab = await getTargetTab(tabId);
    if (!tab) break;
    if (tab.url !== previousUrl) return tab;
    await delay(interval);
  }
  return await getTargetTab(tabId) ?? { url: previousUrl };
}

function resolveKeyInfo(keyName) {
  const mapped = KEY_MAP[keyName];
  if (mapped) {
    return {
      key: mapped.key ?? keyName,
      code: mapped.code,
      windowsVirtualKeyCode: mapped.keyCode,
      text: mapped.text ?? null,
    };
  }

  if (keyName.length === 1) {
    const upper = keyName.toUpperCase();
    const code = `Key${upper}`;
    const keyCode = upper.charCodeAt(0);
    return { key: keyName, code, windowsVirtualKeyCode: keyCode, text: keyName };
  }

  return { key: keyName, code: keyName, windowsVirtualKeyCode: 0, text: null };
}

function parseModifiers(modifiersStr) {
  if (!modifiersStr) return 0;
  let mask = 0;
  const parts = String(modifiersStr).toLowerCase().split('+');
  for (const part of parts) {
    const p = part.trim();
    if (p === 'alt') mask |= 1;
    if (p === 'ctrl' || p === 'control') mask |= 2;
    if (p === 'meta' || p === 'cmd' || p === 'command') mask |= 4;
    if (p === 'shift') mask |= 8;
  }
  return mask;
}

async function executeKey(action) {
  const keyName = String(action.key || '').trim();
  if (!keyName) {
    return { ok: false, error: 'Key action requires a key parameter.' };
  }

  const tab = await getTargetTab(action.tabId);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for key action.' };
  }

  const keyInfo = resolveKeyInfo(keyName);
  const modifiers = parseModifiers(action.modifiers);
  const repeatCount = Math.max(1, Math.min(Number(action.repeat) || 1, 100));

  // Only send text for keyDown when no modifier keys are held,
  // so shortcuts like Ctrl+A don't accidentally insert characters.
  const text = modifiers === 0 && keyInfo.text ? keyInfo.text : undefined;

  await withDebuggerSession(tab.id, async ({ sendCommand }) => {
    for (let i = 0; i < repeatCount; i++) {
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers,
        key: keyInfo.key,
        code: keyInfo.code,
        windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
        text,
      });
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers,
        key: keyInfo.key,
        code: keyInfo.code,
        windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      });
      if (repeatCount > 1 && i < repeatCount - 1) {
        await delay(30);
      }
    }
  });

  // Enter/Space/Tab can trigger navigation. Poll until URL changes or times out.
  const mayNavigate = ['Enter', 'Space', 'Tab'].includes(keyName);
  const freshTab = mayNavigate ? await waitForTabUrlChange(tab.id, tab.url) : tab;

  return {
    ok: true,
    action: 'key',
    via: 'cdp',
    tab: describeTab(freshTab),
    key: keyName,
    modifiers: action.modifiers || null,
    repeat: repeatCount,
  };
}

async function resolveActionCoordinate(action, snapshot) {
  const directCoordinate = normalizeCoordinate(action);
  const tab = await getTargetTab(action.tabId);

  if (directCoordinate && !tab) {
    return { ok: false, error: 'No active tab available for coordinate action.' };
  }

  if (directCoordinate && tab) {
    return {
      ok: true,
      tab,
      coordinate: directCoordinate,
      target: null,
    };
  }

  if (action.refId == null && action.ref_id == null && !action.selector) {
    return {
      ok: false,
      error: 'Action requires either x/y coordinates or a refId/selector target.',
    };
  }

  const resolved = await snapshot.resolveActionTarget(action);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    tab: resolved.tab,
    coordinate: resolved.coordinate,
    target: resolved.target,
  };
}

async function resolveScrollTarget(action, snapshot, tabId) {
  const directCoordinate = normalizeCoordinate(action);
  if (directCoordinate) {
    return { ok: true, coordinate: directCoordinate, target: null };
  }

  if (action.refId != null || action.ref_id != null || action.selector) {
    const resolved = await snapshot.resolveActionTarget({ ...action, tabId });
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      coordinate: resolved.coordinate,
      target: resolved.target,
    };
  }

  const context = await snapshot.getActiveTabContext({ tabId });
  if (!context.ok) return context;

  return {
    ok: true,
    coordinate: {
      x: Math.round((context.page?.viewport?.width ?? 1280) / 2),
      y: Math.round((context.page?.viewport?.height ?? 720) / 2),
    },
    target: null,
  };
}

function normalizeAction(action) {
  return {
    ...action,
    type: String(action?.type || '').trim(),
    button: action?.button === 'right' ? 'right' : 'left',
    tabId: Number.isInteger(Number(action?.tabId)) ? Number(action.tabId) : null,
    refId:
      action?.refId != null
        ? normalizeRefId(action.refId)
        : normalizeRefId(action?.ref_id),
    ref_id: normalizeRefId(action?.ref_id),
  };
}

function normalizeRefId(refId) {
  if (typeof refId === 'string' && /^ref_\d+$/i.test(refId)) {
    return Number(refId.replace(/^ref_/i, ''));
  }

  const parsed = Number(refId);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeCoordinate(action) {
  const coordinate = action?.coordinate ?? null;
  const x = coordinate?.x ?? action?.x;
  const y = coordinate?.y ?? action?.y;

  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
    return null;
  }

  return {
    x: Math.round(Number(x)),
    y: Math.round(Number(y)),
  };
}

function resolveScrollDelta(action) {
  if (Number.isFinite(Number(action.deltaY))) {
    return Number(action.deltaY);
  }

  const amount = Number.isFinite(Number(action.amount))
    ? Number(action.amount)
    : DEFAULT_SCROLL_DELTA_Y;
  const direction = String(action.direction || 'down').toLowerCase();

  if (direction === 'up') return -Math.abs(amount);
  return Math.abs(amount);
}

function clampQuality(quality) {
  const parsed = Number(quality);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(10, Math.min(100, Math.round(parsed)));
}

function getSelectAllModifier() {
  const userAgent = globalThis.navigator?.userAgent || '';
  const platform = globalThis.navigator?.platform || '';
  return /mac/i.test(userAgent) || /mac/i.test(platform) ? 4 : 2;
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
