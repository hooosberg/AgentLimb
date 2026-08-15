export function createMvpStore(options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || defaultCreateId;
  const createToken = options.createToken || (() => `term_${defaultCreateId()}`);

  const terminals = new Map();
  const tasks = new Map();
  const browserCalls = new Map();
  const extensions = new Map();
  let extensionLastPollAt = null;

  const EXTENSION_ONLINE_WINDOW_MS = 10_000;

  // Task lifecycle tools are UI signals, not browser side-effects. When AI
  // broadcasts one of these (no target) and there are multiple active profiles,
  // every profile's sidepanel should receive the event — otherwise task state
  // gets shredded across panels (see 开发进度10 §六·Level 2). We fan-out by
  // creating one targeted child call per active extension.
  const BROADCAST_TOOLS = new Set([
    'task_plan',
    'task_step_done',
    'task_complete',
    'task_fail',
  ]);

  function isOnline(entry) {
    return Date.now() - new Date(entry.lastSeen).getTime() < EXTENSION_ONLINE_WINDOW_MS;
  }

  // The sidepanel is the user's explicit "opt-in" surface for a profile. If no
  // panel is open, the user has effectively opted that profile out — treat it
  // as suspended so broadcast fan-out skips it silently instead of the task
  // partly succeeding on one panel and failing on a ghost window elsewhere.
  // `panelActive` is carried on every SW poll (defaults to true so pre-poll
  // records and unit tests that never push the signal stay active).
  function isEffectivelySuspended(entry) {
    if (entry.manualSuspended === true) return true;
    if (entry.panelActive === false) return true;
    return false;
  }

  function cloneExtension(entry) {
    return {
      ...entry,
      online: isOnline(entry),
      suspended: isEffectivelySuspended(entry),
    };
  }

  function snapshotExtensions() {
    return [...extensions.values()].map(cloneExtension);
  }

  // Resolve a target string to an extension entry.
  // The target can be either an extensionId (exact match) or a label (case-insensitive).
  // Returns null if no matching extension is registered.
  function resolveTargetExtension(target) {
    const raw = String(target || '').trim();
    if (!raw) return null;

    const direct = extensions.get(raw);
    if (direct) return direct;

    const lower = raw.toLowerCase();
    for (const entry of extensions.values()) {
      if (entry.label && entry.label.toLowerCase() === lower) return entry;
    }
    return null;
  }

  return {
    recordExtensionPoll(input = {}) {
      const timestamp = now();
      extensionLastPollAt = timestamp;

      const extensionId = String(input.extensionId || '').trim();
      if (!extensionId) return;

      const label = String(input.label || '').trim();
      const userAgent = String(input.userAgent || '').trim();
      const existing = extensions.get(extensionId);
      // panelActive is undefined when the caller didn't pass the signal (older
      // SW builds, unit tests) — default to true so we don't accidentally
      // suspend a profile that pre-dates the panel-heartbeat feature.
      const panelActive =
        input.panelActive === true
          ? true
          : input.panelActive === false
            ? false
            : (existing?.panelActive ?? true);

      extensions.set(extensionId, {
        id: extensionId,
        label: label || existing?.label || '',
        userAgent: userAgent || existing?.userAgent || '',
        firstSeen: existing?.firstSeen || timestamp,
        lastSeen: timestamp,
        manualSuspended: existing?.manualSuspended === true,
        panelActive,
      });
    },

    listExtensions() {
      return snapshotExtensions();
    },

    setExtensionSuspended(extensionId, suspended) {
      const id = String(extensionId || '').trim();
      if (!id) throw new Error('extensionId is required.');

      const entry = extensions.get(id);
      if (!entry) throw new Error(`Unknown extension: ${id}`);

      const wantSuspend = Boolean(suspended);
      if (entry.manualSuspended === wantSuspend) {
        return cloneExtension(entry);
      }

      // Last-worker guard: can't suspend if it would leave zero active online
      // workers. Panel-closed workers also count as inactive here — suspending
      // the only panel-open profile would silently drop every subsequent call.
      if (wantSuspend) {
        const otherActive = [...extensions.values()].some((other) => {
          if (other.id === id) return false;
          if (isEffectivelySuspended(other)) return false;
          return isOnline(other);
        });
        if (!otherActive) {
          const err = new Error('Cannot suspend the only active worker.');
          err.code = 'LAST_ACTIVE_WORKER';
          throw err;
        }
      }

      entry.manualSuspended = wantSuspend;
      return cloneExtension(entry);
    },
    registerTerminal(input = {}) {
      const name = String(input.name || 'Terminal').trim() || 'Terminal';
      const type = String(input.type || 'generic').trim() || 'generic';
      const cwd = String(input.cwd || '').trim();
      const token = createToken();
      const connectedAt = now();

      const terminal = {
        token,
        name,
        type,
        cwd,
        connectedAt,
        lastSeen: connectedAt,
      };

      terminals.set(token, terminal);
      return clone(terminal);
    },

    listTerminals() {
      return [...terminals.values()].map(clone);
    },

    submitPrompt(input = {}) {
      const prompt = String(input.prompt || '').trim();
      if (!prompt) {
        throw new Error('Prompt is required.');
      }

      const id = `task_${createId()}`;
      const task = {
        id,
        prompt,
        source: String(input.source || 'sidepanel'),
        status: 'queued',
        createdAt: now(),
        claimedAt: null,
        completedAt: null,
        claimedBy: null,
        metadata: normalizeMetadata(input.metadata),
        result: null,
      };

      tasks.set(id, task);
      return clone(task);
    },

    claimNextTask(input = {}) {
      const terminal = requireTerminal(input.token, terminals);
      terminal.lastSeen = now();

      let task = null;
      const requestedTaskId = String(input.taskId || '').trim();
      if (requestedTaskId) {
        const requestedTask = tasks.get(requestedTaskId);
        if (!requestedTask) {
          throw new Error(`Task not found: ${requestedTaskId}`);
        }
        if (requestedTask.status !== 'queued') {
          throw new Error(`Task is not claimable: ${requestedTaskId}`);
        }
        task = requestedTask;
      } else {
        task = [...tasks.values()]
          .filter((entry) => entry.status === 'queued')
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      }

      if (!task) return null;

      task.status = 'claimed';
      task.claimedAt = now();
      task.claimedBy = {
        token: terminal.token,
        name: terminal.name,
        type: terminal.type,
      };

      return clone(task);
    },

    submitResult(input = {}) {
      const terminal = requireTerminal(input.token, terminals);
      terminal.lastSeen = now();

      const taskId = String(input.taskId || '').trim();
      if (!taskId) {
        throw new Error('taskId is required.');
      }

      const task = tasks.get(taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (task.claimedBy?.token !== terminal.token) {
        throw new Error('Task was claimed by another terminal.');
      }

      const ok = Boolean(input.ok);
      task.status = ok ? 'completed' : 'failed';
      task.completedAt = now();
      task.result = {
        ok,
        output: input.output != null ? String(input.output) : '',
        error: input.error != null ? String(input.error) : '',
        updatedAt: task.completedAt,
      };

      return clone(task);
    },

    getTask(taskId) {
      const task = tasks.get(String(taskId || '').trim());
      return task ? clone(task) : null;
    },

    submitBrowserToolCall(input = {}) {
      const tool = String(input.tool || '').trim();
      if (!tool) {
        throw new Error('tool is required.');
      }

      let target = null;
      let targetLabel = null;
      const rawTarget = String(input.target || '').trim();
      if (rawTarget) {
        const resolved = resolveTargetExtension(rawTarget);
        if (!resolved) {
          const err = new Error(`Target extension not registered: ${rawTarget}`);
          err.code = 'TARGET_NOT_FOUND';
          err.target = rawTarget;
          throw err;
        }
        if (isEffectivelySuspended(resolved)) {
          const err = new Error(
            `Target extension is suspended: ${resolved.label || resolved.id}`,
          );
          err.code = 'TARGET_SUSPENDED';
          err.target = resolved.id;
          err.label = resolved.label;
          throw err;
        }
        target = resolved.id;
        targetLabel = resolved.label || null;
      }

      const params = normalizeMetadata(input.params);
      const source = String(input.source || 'terminal');

      // Fan-out: broadcast tool + no explicit target + 2+ active extensions →
      // create one targeted child per active extension, return an aggregating parent.
      if (!target && BROADCAST_TOOLS.has(tool)) {
        const activeExts = [...extensions.values()].filter(
          (entry) => !isEffectivelySuspended(entry) && isOnline(entry),
        );
        if (activeExts.length > 1) {
          const parentId = `call_${createId()}`;
          const createdAt = now();
          const childIds = [];
          for (const ext of activeExts) {
            const childId = `call_${createId()}`;
            browserCalls.set(childId, {
              id: childId,
              parent: parentId,
              tool,
              params,
              source,
              target: ext.id,
              targetLabel: ext.label || null,
              broadcast: true,
              status: 'queued',
              createdAt,
              claimedAt: null,
              claimedBy: null,
              completedAt: null,
              result: null,
            });
            childIds.push(childId);
          }
          const parent = {
            id: parentId,
            tool,
            params,
            source,
            target: null,
            targetLabel: null,
            broadcast: true,
            fanout: childIds,
            status: 'queued',
            createdAt,
            claimedAt: null,
            claimedBy: null,
            completedAt: null,
            result: null,
          };
          browserCalls.set(parentId, parent);
          return clone(parent);
        }
        // 0 or 1 active extension: fall through to normal single-call queue.
      }

      const id = `call_${createId()}`;
      const call = {
        id,
        tool,
        params,
        source,
        target,
        targetLabel,
        status: 'queued',
        createdAt: now(),
        claimedAt: null,
        claimedBy: null,
        completedAt: null,
        result: null,
      };

      browserCalls.set(id, call);
      return clone(call);
    },

    claimNextBrowserToolCall(input = {}) {
      const extensionId = String(input.extensionId || '').trim() || null;

      // Hard suspend: suspended extensions claim nothing — not broadcast, not targeted.
      // submitBrowserToolCall already refuses targeted calls to suspended extensions,
      // but this is a belt-and-braces guard for any queued call that predated the suspend.
      const selfEntry = extensionId ? extensions.get(extensionId) : null;
      if (selfEntry && isEffectivelySuspended(selfEntry)) return null;

      const call = [...browserCalls.values()]
        .filter((entry) => {
          if (entry.status !== 'queued') return false;
          // Broadcast parents are aggregators — never claimed directly; their
          // children (with concrete target) are what extensions claim.
          if (Array.isArray(entry.fanout)) return false;
          if (entry.target) {
            return extensionId != null && entry.target === extensionId;
          }
          return true;
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

      if (!call) return null;

      call.status = 'claimed';
      call.claimedAt = now();
      call.claimedBy = extensionId;
      return clone(call);
    },

    submitBrowserToolResult(input = {}) {
      const callId = String(input.callId || '').trim();
      if (!callId) {
        throw new Error('callId is required.');
      }

      const call = browserCalls.get(callId);
      if (!call) {
        throw new Error(`Browser call not found: ${callId}`);
      }

      call.status = input.ok ? 'completed' : 'failed';
      call.completedAt = now();
      call.result = input.ok
        ? normalizeMetadata(input.result)
        : {
            error: input.error != null ? String(input.error) : 'Unknown browser call error',
          };

      return clone(call);
    },

    getBrowserToolCall(callId) {
      const call = browserCalls.get(String(callId || '').trim());
      if (!call) return null;

      // Broadcast parent: aggregate status from children so AI polling sees a
      // single coherent status transition. First child to complete unblocks the
      // parent; the parent's result echoes the first successful child's result
      // (broadcast tools are idempotent UI signals — all children converge).
      if (Array.isArray(call.fanout) && call.fanout.length > 0) {
        const children = call.fanout
          .map((id) => browserCalls.get(id))
          .filter(Boolean);

        const firstCompleted = children.find((c) => c.status === 'completed');
        if (firstCompleted) {
          call.status = 'completed';
          call.completedAt = call.completedAt || firstCompleted.completedAt;
          call.result = call.result || firstCompleted.result;
        } else {
          const allDone = children.length > 0 && children.every(
            (c) => c.status === 'completed' || c.status === 'failed',
          );
          if (allDone) {
            const last = children[children.length - 1];
            call.status = 'failed';
            call.completedAt = call.completedAt || last.completedAt;
            call.result = call.result || {
              error: 'All broadcast children failed',
              children: children.map((c) => ({ id: c.id, target: c.target, status: c.status })),
            };
          } else if (children.some((c) => c.status === 'claimed')) {
            call.status = 'claimed';
          }
        }
      }

      return clone(call);
    },

    getStatus() {
      const allTasks = [...tasks.values()];
      // Exclude broadcast parents from stats — they are virtual aggregators;
      // the concrete work is in their children, which are already counted here.
      const allBrowserCalls = [...browserCalls.values()].filter(
        (call) => !Array.isArray(call.fanout),
      );
      const nowMs = Date.now();
      const extensionOnline =
        extensionLastPollAt != null &&
        nowMs - new Date(extensionLastPollAt).getTime() < EXTENSION_ONLINE_WINDOW_MS;
      const extensionList = snapshotExtensions();
      return {
        terminals: terminals.size,
        extension: {
          lastPollAt: extensionLastPollAt,
          online: extensionOnline,
        },
        extensions: {
          total: extensionList.length,
          online: extensionList.filter((entry) => entry.online).length,
          list: extensionList,
        },
        tasks: {
          total: allTasks.length,
          queued: allTasks.filter((task) => task.status === 'queued').length,
          claimed: allTasks.filter((task) => task.status === 'claimed').length,
          completed: allTasks.filter((task) => task.status === 'completed').length,
          failed: allTasks.filter((task) => task.status === 'failed').length,
        },
        browserCalls: {
          total: allBrowserCalls.length,
          queued: allBrowserCalls.filter((call) => call.status === 'queued').length,
          claimed: allBrowserCalls.filter((call) => call.status === 'claimed').length,
          completed: allBrowserCalls.filter((call) => call.status === 'completed').length,
          failed: allBrowserCalls.filter((call) => call.status === 'failed').length,
        },
      };
    },
  };
}

function requireTerminal(token, terminals) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    throw new Error('Terminal token is required.');
  }

  const terminal = terminals.get(normalizedToken);
  if (!terminal) {
    throw new Error('Unknown terminal token.');
  }

  return terminal;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return structuredClone(metadata);
}

function defaultCreateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return structuredClone(value);
}
