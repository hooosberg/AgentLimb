import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('runtime package explicitly enables Node ESM', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=18');
});

test('Windows installer installs the runtime and registers the expected host', async () => {
  const installer = await read('scripts/windows/install.ps1');
  assert.match(installer, /AgentLimb Bridge/);
  assert.match(installer, /NativeMessagingHosts\\com\.agentlimb\.bridge/);
  assert.match(installer, /Start-ScheduledTask/);
  assert.match(installer, /New-ScheduledTaskPrincipal/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(installer, /127\.0\.0\.1:7791/);
  assert.match(installer, /hldldfepjhljhbcneojddjkkodkjglof/);
  assert.match(installer, /Remove-Item -LiteralPath \$installedKernel/);
  assert.match(installer, /agentlimb-bridge\.error\.log/);
  assert.match(installer, /Microsoft\\Edge\\NativeMessagingHosts/);
  assert.match(installer, /agentlimb-native-host\.exe/);
  assert.match(installer, /\\csc\.exe/);
});

test('side panel addresses the installed Windows CLI without changing macOS fallback', async () => {
  const sidePanel = await read('ui/sidepanel/sidepanel.js');
  assert.match(sidePanel, /\$env:LOCALAPPDATA\\\\AgentLimb\\\\bin\\\\agentlimb\.cmd/);
  assert.match(sidePanel, /~\/\.agentlimb\/bin\/agentlimb/);
  assert.match(sidePanel, /agentlimb_project_path_source/);
  assert.match(sidePanel, /storedSource === 'manual'/);
});

test('native host is a compiled executable with Chrome length-prefixed JSON framing', async () => {
  const host = await read('scripts/windows/AgentLimbNativeHost.cs');
  assert.match(host, /BitConverter\.ToInt32/);
  assert.match(host, /BitConverter\.GetBytes/);
  assert.match(host, /projectDir/);
});

test('Windows package includes restart logging and a reversible uninstall', async () => {
  const starter = await read('scripts/windows/start-bridge.ps1');
  const uninstaller = await read('scripts/windows/uninstall.ps1');
  assert.match(starter, /agentlimb-bridge\.log/);
  assert.match(starter, /agentlimb-bridge\.error\.log/);
  assert.match(starter, /5MB/);
  assert.match(uninstaller, /ShouldProcess/);
  assert.match(uninstaller, /Unregister-ScheduledTask/);
  assert.match(uninstaller, /Muscle files.*preserved/);
});
