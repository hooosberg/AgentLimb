import { bootstrapRuntime, ensureRelayRunning } from './runtime/bootstrap.js';

bootstrapRuntime();

// MV3 keep-alive: restart relay when alarm wakes the SW from suspension
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'agentlimb-relay-keepalive') {
    ensureRelayRunning();
  }
});
