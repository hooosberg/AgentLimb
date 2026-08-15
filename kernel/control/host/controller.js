import { summarizeHostTools, HOST_TOOLS } from './tools.js';
import {
  getTargetTab,
  describeTab,
  delay,
  isInjectableUrl,
  injectScriptIfNeeded,
  sendToTab,
} from '../background/runtime/browser.js';
import { withDebuggerSession } from '../background/runtime/debugger.js';
import { MVP_HOST_BASE_URL } from '../../shared/mvp-config.js';
import { normalizeDomain } from '../../muscle/schema.js';
import { profileToMarkdown, isEmpty } from '../../muscle/serializer.js';
import { createMuscleStore } from '../../muscle/store.js';
import { flushSession } from '../../muscle/auto-capture.js';

const CONTENT_SCRIPT_PATH = 'kernel/control/content/injector.js';

export function createHostController({
  app,
  capabilities,
  strategy,
  permissions,
  snapshot,
  computer,
}) {
  const sessionId = makeSessionId();

  // Muscle auto-loop state — lives in SW scope so it survives tool calls but
  // resets on SW restart (safe; storage.local layer holds the truth).
  const muscleStore = createMuscleStore({ hostBaseUrl: MVP_HOST_BASE_URL });
  const autoLoopState = {
    lastRecalledDomain: null,
    muscleCommitCalled: false,
    // Observe-Act-Observe loop guard: counts consecutive write actions
    // (click/type/key/drag/form_input) since the last observation
    // (snapshot/eval/screenshot/tabs_context). Reset on every observe.
    // navigate bumps it to the threshold so the first write after a
    // navigation is forced to observe the landed page.
    writesSinceObserve: 0,
    // Commit guard (Gate 2): if the task had real interactions but the
    // session buffer is empty and muscle_remember was never called,
    // muscle_commit(success|partial) is blocked — prevents silent loss
    // of selectors found via page_snapshot / javascript_eval.
    interactionCount: 0,
    hasMuscleRemember: false,
  };

  const WRITE_BEFORE_OBSERVE_THRESHOLD = 3;

  return {
    async getStatus() {
      return {
        ready: true,
        sessionId,
        transport: 'chrome.runtime',
        toolCount: HOST_TOOLS.length,
        tools: summarizeHostTools(),
      };
    },

    async listTools() {
      return {
        ok: true,
        session: {
          id: sessionId,
          transport: 'chrome.runtime',
          app,
        },
        tools: HOST_TOOLS,
      };
    },

    async callTool(request = {}) {
      const toolName = String(request.tool || request.name || '').trim();
      const params = request.params || {};
      const requestId = request.requestId ?? null;

      if (!toolName) {
        return {
          ok: false,
          requestId,
          error: 'Host call requires a tool name.',
        };
      }

      // Gate 1 — Write-before-observe. Force AI back into the OODA loop
      // when it has written too many times without observing the page.
      if (isWriteCall(toolName, params)
        && autoLoopState.writesSinceObserve >= WRITE_BEFORE_OBSERVE_THRESHOLD) {
        return {
          ok: false,
          requestId,
          tool: toolName,
          error: 'observation_required',
          hint: `Observation required before writing. ` +
            `Call page_snapshot (or javascript_eval / tabs_context / computer.screenshot) to confirm the current page state and enumerate all fields this task requires (e.g. category, visibility, declarations), then retry the write. ` +
            `This fires after navigate/task_plan (page not yet observed) or after repeated writes without an intervening observe. Enforced constraint.`,
        };
      }

      try {
        let result;
        switch (toolName) {
          case 'browser_session':
            result = await buildBrowserSessionResult({
              app,
              capabilities,
              strategy,
              permissions,
              snapshot,
              computer,
              sessionId,
              includeModules: params.includeModules !== false,
            });
            break;
          case 'navigate':
            result = await executeNavigate(params);
            break;
          case 'javascript_eval':
            result = await executeJavascriptEval(params);
            break;
          case 'tabs_context':
            result = await snapshot.getActiveTabContext(params);
            break;
          case 'page_snapshot':
            result = await snapshot.capturePageSnapshot(params);
            break;
          case 'computer':
            result = await computer.executeAction(params);
            break;
          case 'form_input':
            result = await executeFormInput(params);
            break;
          case 'wait':
            result = await executeWait(params);
            break;
          case 'ping':
            result = { ok: true, pong: true, ts: new Date().toISOString(), sessionId };
            break;
          case 'muscle_recall':
            result = await executeMuscleRecall(params);
            break;
          case 'muscle_remember':
            result = await executeMuscleRemember(params);
            if (result?.ok !== false) {
              autoLoopState.hasMuscleRemember = true;
            }
            break;
          case 'muscle_commit': {
            // Gate 2 — Prevent silent loss of knowledge:
            // if the task had real interactions but nothing was auto-captured
            // (session buffer empty) and nothing was manually remembered,
            // success/partial commits would turn into noop — selectors found
            // via snapshot/eval are lost. Block with an actionable hint.
            const commitStatus = String(params?.status || 'manual').toLowerCase();
            const needsKnowledgeCheck = commitStatus === 'success' || commitStatus === 'partial';
            let bufferEmpty = false;
            if (needsKnowledgeCheck) {
              try {
                const buffer = await muscleStore.readSession(MUSCLE_SESSION_ID);
                bufferEmpty = !buffer || buffer.length === 0;
              } catch {
                // Buffer unreadable — err on the side of allowing commit.
              }
            }
            if (needsKnowledgeCheck
              && autoLoopState.interactionCount > 0
              && bufferEmpty
              && !autoLoopState.hasMuscleRemember) {
              result = {
                ok: false,
                error: 'muscle_remember_recommended',
                hint:
                  `This task had ${autoLoopState.interactionCount} write interactions, but the session buffer is empty and muscle_remember was never called. ` +
                  'commit(success|partial) would be a noop — selectors and workflows discovered via page_snapshot / javascript_eval will be lost. ' +
                  'Fix with one of: ' +
                  '(a) call muscle_remember with the selectors/workflow you found, then retry commit; ' +
                  '(b) if there is truly no reusable knowledge, use muscle_commit(status="manual", note="no reusable knowledge: <reason>") first, then retry success/partial.',
              };
            } else {
              result = await executeMuscleCommit(params);
              if (result?.ok !== false) {
                autoLoopState.muscleCommitCalled = true;
              }
            }
            break;
          }
          case 'task_plan':
            result = executeTaskPlan(params);
            if (result?.ok !== false) {
              // New task opens a new observe-act-commit cycle — reset all guards.
              autoLoopState.muscleCommitCalled = false;
              autoLoopState.interactionCount = 0;
              autoLoopState.hasMuscleRemember = false;
              // Force the very first action to be an observation.
              autoLoopState.writesSinceObserve = WRITE_BEFORE_OBSERVE_THRESHOLD;
            }
            break;
          case 'task_step_done':
            result = executeTaskStepDone(params);
            break;
          case 'task_complete':
            result = autoLoopState.muscleCommitCalled
              ? executeTaskComplete(params)
              : {
                  ok: false,
                  error: 'muscle_commit_required',
                  hint: 'Task lifecycle incomplete: call muscle_commit(status=success|partial|failed) before task_complete. Even with nothing to commit, the call returns noop/empty_session — that is not an error. This is an enforced constraint.',
                };
            break;
          case 'task_fail':
            result = autoLoopState.muscleCommitCalled
              ? executeTaskFail(params)
              : {
                  ok: false,
                  error: 'muscle_commit_required',
                  hint: 'Task lifecycle incomplete: call muscle_commit(status=failed) before task_fail. This is an enforced constraint.',
                };
            break;
          default:
            return {
              ok: false,
              requestId,
              tool: toolName,
              error: `Unknown host tool: ${toolName}`,
              availableTools: HOST_TOOLS.map((tool) => tool.name),
            };
        }

        const isOk = Boolean(result?.ok !== false);

        // ── OODA counters ───────────────────────────────────────────
        // Update write/observe counters AFTER the tool ran, so a failed
        // tool call does not poison the loop state.
        if (isOk) {
          if (isObserveCall(toolName, params)) {
            autoLoopState.writesSinceObserve = 0;
          } else if (toolName === 'navigate') {
            // A landed page has not been observed yet — force the next
            // write to snapshot first. The sidecar muscleRecall is a map,
            // not an observation of the current DOM.
            autoLoopState.writesSinceObserve = WRITE_BEFORE_OBSERVE_THRESHOLD;
          } else if (isWriteCall(toolName, params)) {
            autoLoopState.writesSinceObserve += 1;
            autoLoopState.interactionCount += 1;
          }
        }

        // ── Muscle auto-loop hooks ──────────────────────────────────
        // Only runs on successful non-muscle tool calls so we never recurse.
        if (isOk && !toolName.startsWith('muscle_')) {
          try {
            await applyMuscleAutoLoop({
              toolName,
              params,
              result,
              store: muscleStore,
              state: autoLoopState,
              sessionId: MUSCLE_SESSION_ID,
            });
          } catch (err) {
            // Never let muscle hooks crash tool dispatch — just log.
            console.warn('[AgentLimb] muscle auto-loop hook error:', err?.message || err);
          }
        }

        // Promote muscleRecall to top-level so even models that skim past
        // nested fields cannot miss it. Rule 8 in the prompt references this.
        const muscleRecall = result?.sidecar?.muscleRecall;
        const musclePriority = muscleRecall
          ? {
              notice:
                '📍 Muscle knowledge found for this domain (see result.sidecar.muscleRecall.markdown). ' +
                'It is a map, not a script: use it to locate landmarks, then still run page_snapshot to (a) confirm they match and (b) discover task-specific fields (category pickers, visibility toggles, declarations, etc.) the muscle does not cover. Do not act on muscle alone.',
              domain: muscleRecall.domain,
              version: muscleRecall.version,
            }
          : undefined;

        return {
          ok: isOk,
          requestId,
          tool: toolName,
          ...(musclePriority ? { _musclePriority: musclePriority } : {}),
          result,
          error: isOk ? undefined : (result?.error || undefined),
        };
      } catch (error) {
        return {
          ok: false,
          requestId,
          tool: toolName,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// ── OODA classifiers ─────────────────────────────────────────────
// These drive the "write-before-observe" hard gate in callTool.
// Observation = anything that reads the live page state (DOM / URL /
// visual). Write = anything that mutates the page or dispatches input.
// Neutral tools (wait, ping, muscle_*, task_*, browser_session,
// navigate itself) are not counted as either.

const OBSERVE_TOOL_NAMES = new Set([
  'page_snapshot',
  'javascript_eval',
  'tabs_context',
]);

const WRITE_COMPUTER_TYPES = new Set([
  'click',
  'double_click',
  'right_click',
  'type',
  'key',
  'drag',
]);

function isObserveCall(toolName, params) {
  if (OBSERVE_TOOL_NAMES.has(toolName)) return true;
  if (toolName === 'computer' && params?.type === 'screenshot') return true;
  return false;
}

function isWriteCall(toolName, params) {
  if (toolName === 'form_input') return true;
  if (toolName === 'computer') {
    const actionType = params?.type;
    if (WRITE_COMPUTER_TYPES.has(actionType)) return true;
  }
  return false;
}

async function buildBrowserSessionResult({
  app,
  capabilities,
  strategy,
  permissions,
  snapshot,
  computer,
  sessionId,
  includeModules,
}) {
  const modules = includeModules
    ? {
        permissions: permissions.getStatus(),
        snapshot: await snapshot.getStatus(),
        computer: await computer.getStatus(),
      }
    : undefined;

  return {
    ok: true,
    session: {
      id: sessionId,
      transport: 'chrome.runtime',
      toolCount: HOST_TOOLS.length,
      tools: summarizeHostTools(),
      app,
      capabilities,
      strategy,
    },
    modules,
  };
}

async function executeNavigate(params = {}) {
  const urlInput = String(params.url || '').trim();
  if (!urlInput) {
    return { ok: false, error: 'Navigate requires a url parameter.' };
  }

  const tab = await getTargetTab(params.tabId ?? null);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for navigation.' };
  }

  const waitForLoad = params.waitForLoad !== false;
  const timeout = Math.min(
    Math.max(Number(params.timeout) || 15000, 1000),
    30000,
  );

  const lower = urlInput.toLowerCase();

  if (lower === 'back') {
    try {
      await chrome.tabs.goBack(tab.id);
    } catch (err) {
      // New tab has no history — close it and activate the opener tab
      if (tab.openerTabId) {
        await chrome.tabs.remove(tab.id);
        await chrome.tabs.update(tab.openerTabId, { active: true });
        if (waitForLoad) await waitForTabComplete(tab.openerTabId, timeout);
        const opener = await getTargetTab(tab.openerTabId);
        return {
          ok: true,
          navigationType: 'back_close_tab',
          tab: describeTab(opener || tab),
        };
      }
      throw err;
    }
    if (waitForLoad) await waitForTabComplete(tab.id, timeout);
    const updated = await getTargetTab(tab.id);
    return {
      ok: true,
      navigationType: 'back',
      tab: describeTab(updated || tab),
    };
  }

  if (lower === 'forward') {
    try {
      await chrome.tabs.goForward(tab.id);
    } catch (err) {
      return {
        ok: false,
        navigationType: 'forward',
        error: 'No forward history. ' + (err.message || String(err)),
        tab: describeTab(tab),
      };
    }
    if (waitForLoad) await waitForTabComplete(tab.id, timeout);
    const updated = await getTargetTab(tab.id);
    return {
      ok: true,
      navigationType: 'forward',
      tab: describeTab(updated || tab),
    };
  }

  const url =
    /^https?:\/\//i.test(urlInput) || /^file:\/\//i.test(urlInput)
      ? urlInput
      : `https://${urlInput}`;

  await chrome.tabs.update(tab.id, { url });
  if (waitForLoad) await waitForTabComplete(tab.id, timeout);
  const updated = await getTargetTab(tab.id);

  return {
    ok: true,
    navigationType: 'url',
    url,
    tab: describeTab(updated || tab),
  };
}

async function executeFormInput(params = {}) {
  if (params.value === undefined || params.value === null) {
    return { ok: false, error: 'form_input requires a value parameter.' };
  }

  const tab = await getTargetTab(params.tabId ?? null);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for form_input.' };
  }

  if (!isInjectableUrl(tab.url)) {
    return { ok: false, error: 'Current tab is not injectable. Navigate to an http/https page first.' };
  }

  const injection = await injectScriptIfNeeded(tab.id, CONTENT_SCRIPT_PATH);
  if (!injection.ok) {
    return { ok: false, tab: describeTab(tab), error: injection.message };
  }

  const response = await sendToTab(tab.id, {
    type: 'AGENTLIMB_FORM_INPUT',
    target: {
      refId: params.refId ?? params.ref_id ?? null,
      selector: params.selector ?? null,
    },
    value: params.value,
  }, 5000);

  if (!response) {
    return { ok: false, tab: describeTab(tab), error: 'Content script did not respond to form_input.' };
  }

  return { ...response, tab: describeTab(tab) };
}

const MAX_EVAL_RESULT_CHARS = 50000;

async function executeJavascriptEval(params = {}) {
  const expression = String(params.expression || '').trim();
  if (!expression) {
    return { ok: false, error: 'javascript_eval requires an expression parameter.' };
  }

  const tab = await getTargetTab(params.tabId ?? null);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for javascript_eval.' };
  }

  // Wrap in async IIFE to support top-level await
  let wrappedExpression = expression;
  if (/\bawait\b/.test(expression)) {
    // Split on semicolons to handle multi-statement expressions like
    // "await fetch(url); result" — return the last statement's value
    const parts = expression.split(';').map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      wrappedExpression = `(async () => { return (${expression}); })()`;
    } else {
      const head = parts.slice(0, -1).join(';\n');
      const tail = parts[parts.length - 1];
      wrappedExpression = `(async () => { ${head};\nreturn (${tail}); })()`;
    }
  }

  try {
    const evalResult = await withDebuggerSession(tab.id, async ({ sendCommand }) => {
      return sendCommand('Runtime.evaluate', {
        expression: wrappedExpression,
        returnByValue: true,
        awaitPromise: true,
        generatePreview: false,
      });
    });

    if (evalResult?.exceptionDetails) {
      const ex = evalResult.exceptionDetails;
      const errorText =
        ex.exception?.description || ex.text || 'Evaluation error';
      return {
        ok: false,
        tab: describeTab(tab),
        error: errorText,
      };
    }

    let value = evalResult?.result?.value;
    if (typeof value === 'string' && value.length > MAX_EVAL_RESULT_CHARS) {
      value = value.slice(0, MAX_EVAL_RESULT_CHARS) + '... (truncated)';
    }

    return {
      ok: true,
      tab: describeTab(tab),
      type: evalResult?.result?.type || 'undefined',
      value,
    };
  } catch (error) {
    return {
      ok: false,
      tab: describeTab(tab),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeWait(params = {}) {
  const tab = await getTargetTab(params.tabId ?? null);
  if (!tab?.id) {
    return { ok: false, error: 'No active tab available for wait.' };
  }

  const timeout = Math.min(Math.max(Number(params.timeout) || 10000, 1000), 30000);
  const condition = params.condition || (params.selector ? 'visible' : 'page_load');
  const startTime = Date.now();

  // URL-based wait
  if (condition === 'url_contains') {
    const text = String(params.text || params.selector || '').trim();
    if (!text) {
      return { ok: false, error: 'url_contains requires a text parameter.' };
    }

    const interval = 300;
    while (Date.now() - startTime < timeout) {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.url && current.url.includes(text)) {
          return {
            ok: true,
            waited: true,
            condition,
            durationMs: Date.now() - startTime,
            tab: describeTab(current),
          };
        }
      } catch { break; }
      await delay(interval);
    }
    return { ok: false, error: 'Timeout waiting for URL match.', condition, durationMs: Date.now() - startTime };
  }

  // Page load wait
  if (condition === 'page_load') {
    const interval = 300;
    while (Date.now() - startTime < timeout) {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete') {
          return {
            ok: true,
            waited: true,
            condition,
            durationMs: Date.now() - startTime,
            tab: describeTab(current),
          };
        }
      } catch { break; }
      await delay(interval);
    }
    return { ok: false, error: 'Timeout waiting for page load.', condition, durationMs: Date.now() - startTime };
  }

  // Element-based wait (visible, hidden, exists, page_contains)
  // Accept "text" as fallback for "selector" (AI terminals sometimes use "text" key).
  // But if text looks like plain page content rather than a CSS selector, auto-promote
  // visible/exists to page_contains so "wait(visible, text:'Hello World')" works correctly.
  const textParam = String(params.text || '').trim();
  let selector = params.selector || (textParam || null);
  let effectiveCondition = condition;
  if (!params.selector && textParam && (condition === 'visible' || condition === 'exists')) {
    const hasCssSyntax = /[#.[\]:*]/.test(textParam);
    const isSingleWord = /^\w+$/.test(textParam);
    if (!hasCssSyntax && !isSingleWord) {
      // Multi-word plain text — treat as page content search
      effectiveCondition = 'page_contains';
    }
  }
  if (!selector) {
    return { ok: false, error: `Condition "${effectiveCondition}" requires a selector or text parameter.` };
  }

  // page_contains: poll via one-shot script injection in the SW.
  // This avoids relying on the content script's long-lived Promise surviving
  // a form-submit / navigation that destroys the page mid-wait.
  if (effectiveCondition === 'page_contains') {
    const searchText = selector;
    const interval = 500;
    while (Date.now() - startTime < timeout) {
      try {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === 'complete' && isInjectableUrl(current.url)) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (text) => (document.body?.textContent || '').includes(text),
            args: [searchText],
          });
          if (results?.[0]?.result === true) {
            const updated = await getTargetTab(tab.id);
            return {
              ok: true,
              waited: true,
              condition: effectiveCondition,
              durationMs: Date.now() - startTime,
              tab: describeTab(updated || tab),
            };
          }
        }
      } catch { /* tab is navigating — retry next cycle */ }
      await delay(interval);
    }
    return {
      ok: false,
      error: 'Timeout waiting for page content.',
      condition: effectiveCondition,
      durationMs: Date.now() - startTime,
    };
  }

  if (!isInjectableUrl(tab.url)) {
    return { ok: false, error: 'Current tab is not injectable.' };
  }

  const injection = await injectScriptIfNeeded(tab.id, CONTENT_SCRIPT_PATH);
  if (!injection.ok) {
    return { ok: false, tab: describeTab(tab), error: injection.message };
  }

  const response = await sendToTab(tab.id, {
    type: 'AGENTLIMB_WAIT_FOR',
    selector,
    condition: effectiveCondition,
    timeout,
  }, timeout + 2000);

  if (!response) {
    return { ok: false, error: 'Content script did not respond to wait request.', condition: effectiveCondition, durationMs: Date.now() - startTime };
  }

  return { ...response, tab: describeTab(tab), condition: effectiveCondition };
}

async function waitForTabComplete(tabId, timeout = 15000) {
  const start = Date.now();
  const interval = 300;

  while (Date.now() - start < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      return;
    }
    await delay(interval);
  }
}

async function executeMuscleRecall(params = {}) {
  let domain = params.domain ? normalizeDomain(params.domain) : null;

  if (!domain) {
    const tab = await getTargetTab(null);
    if (tab?.url) domain = normalizeDomain(tab.url);
  }

  if (!domain) {
    return { ok: false, error: 'Cannot determine domain. Provide domain param or navigate to an http/https page.' };
  }

  let profile = null;
  try {
    const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/read?domain=${encodeURIComponent(domain)}`);
    const data = await res.json();
    if (data.ok) profile = data.profile;
  } catch {
    // Host unreachable — return empty profile
  }

  const finalProfile = profile || createEmptyProfile(domain);
  const markdown = profile && !isEmpty(profile) ? profileToMarkdown(profile) : null;

  return {
    ok: true,
    domain,
    profile: finalProfile,
    markdown,
    hasKnowledge: Boolean(markdown),
  };
}

async function executeMuscleRemember(params = {}) {
  const patch = params.patch;
  if (!patch || typeof patch !== 'object') {
    return { ok: false, error: 'muscle_remember requires a patch object.' };
  }

  let domain = params.domain ? normalizeDomain(params.domain) : null;

  if (!domain) {
    const tab = await getTargetTab(null);
    if (tab?.url) domain = normalizeDomain(tab.url);
  }

  if (!domain) {
    return { ok: false, error: 'Cannot determine domain. Provide domain param or navigate to an http/https page.' };
  }

  // Single atomic merge-on-server call: avoids the GET→merge→POST race with concurrent muscle_recall.
  try {
    const res = await fetch(`${MVP_HOST_BASE_URL}/api/mvp/muscle/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, patch }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error || 'Merge failed', domain };
    return { ok: true, domain, version: data.version, path: data.path, bytesWritten: data.bytes };
  } catch (err) {
    return { ok: false, error: `Host unreachable: ${err.message}`, domain };
  }
}

const MUSCLE_SESSION_ID = 'current';

/**
 * Post-tool hook: on successful tool calls, automatically
 *   ① recall site muscle when navigating into a new domain (attach sidecar)
 *   ② capture reliable selectors from computer.click successes (append to session buffer)
 *
 * Never throws — muscle is optional infrastructure.
 */
async function applyMuscleAutoLoop({ toolName, params, result, store, state, sessionId }) {
  // ── Auto-recall: navigate success into a new domain ──
  if (toolName === 'navigate' && result && result.ok !== false) {
    const url = result.tab?.url || result.url;
    const domain = url ? normalizeDomain(url) : null;
    if (domain && domain !== state.lastRecalledDomain) {
      state.lastRecalledDomain = domain;
      try {
        const profile = await store.get(domain);
        if (profile && !isEmpty(profile)) {
          result.sidecar = {
            ...(result.sidecar || {}),
            muscleRecall: {
              domain,
              markdown: profileToMarkdown(profile),
              version: profile.version,
              source: 'auto-recall',
            },
          };
        }
      } catch {
        // Store read failure — proceed without sidecar
      }
    }
  }

  // ── Auto-capture: computer.click success with a concrete selector ──
  if (toolName === 'computer' && result && result.ok !== false) {
    const action = params?.type || params?.action;
    if (action === 'click' && result.target?.selector) {
      const url = result.tab?.url;
      const domain = url ? normalizeDomain(url) : null;
      if (domain) {
        try {
          await store.appendSession(sessionId, {
            domain,
            role: result.target.role || null,
            label: result.target.label || null,
            selector: result.target.selector,
            at: new Date().toISOString(),
          });
        } catch {
          // Session buffer append failure is non-fatal
        }
      }
    }
  }
}

async function executeMuscleCommit(params = {}) {
  const status = String(params.status || 'manual').toLowerCase();
  const validStatuses = ['manual', 'success', 'partial', 'failed'];
  if (!validStatuses.includes(status)) {
    return {
      ok: false,
      error: `Invalid status "${status}". Expected one of: ${validStatuses.join(', ')}`,
    };
  }

  // manual mode needs a note (at least a short one) so the note feed stays useful
  if (status === 'manual' && (!params.note || !String(params.note).trim())) {
    return {
      ok: false,
      error: 'muscle_commit status=manual requires a non-empty note explaining why.',
    };
  }

  const store = createMuscleStore({ hostBaseUrl: MVP_HOST_BASE_URL });

  const flushParams = {
    taskId: MUSCLE_SESSION_ID,
    status,
    note: params.note ? String(params.note).trim() : null,
    verification: params.verification ? String(params.verification).trim() : null,
    workflowName: params.workflowName ? String(params.workflowName).trim() : null,
    stepsCompleted: Number.isFinite(Number(params.stepsCompleted))
      ? Number(params.stepsCompleted)
      : null,
  };

  const result = await flushSession({ store }, flushParams);
  return { ...result, status, sessionId: MUSCLE_SESSION_ID };
}

function executeTaskPlan(params = {}) {
  const title = String(params.title || '').trim();
  if (!title) return { ok: false, error: 'task_plan requires a title.' };
  const rawSteps = Array.isArray(params.steps) ? params.steps : [];
  if (!rawSteps.length) return { ok: false, error: 'task_plan requires at least one step.' };
  const steps = rawSteps.map((s) => {
    if (typeof s === 'string') return { text: s, hint: 'tool_call' };
    return {
      text: String(s.text || ''),
      hint: ['tool_call', 'terminal_connected', 'explicit'].includes(s.hint) ? s.hint : 'tool_call',
    };
  });
  return { ok: true, title, steps };
}

function executeTaskStepDone(params = {}) {
  const index = Number(params.index);
  if (!Number.isFinite(index) || index < 0) {
    return { ok: false, error: 'task_step_done requires a non-negative index.' };
  }
  const ok = params.ok !== false;
  const note = params.note ? String(params.note) : undefined;
  return { ok: true, index, stepOk: ok, note, status: ok ? 'done' : 'error' };
}

function executeTaskComplete(params = {}) {
  const summary = params.summary ? String(params.summary) : undefined;
  return { ok: true, status: 'success', summary };
}

function executeTaskFail(params = {}) {
  const reason = String(params.reason || '').trim();
  if (!reason) return { ok: false, error: 'task_fail requires a reason.' };
  const stepIndex = Number.isFinite(Number(params.stepIndex)) ? Number(params.stepIndex) : undefined;
  return { ok: true, status: 'failed', reason, stepIndex };
}

function makeSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
