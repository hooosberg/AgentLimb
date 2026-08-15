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
  assert.match(installer, /Remove-Item -LiteralPath \$path -Recurse -Force/);
  assert.match(installer, /AgentLimb Runtime archive is incomplete/);
  assert.match(installer, /bin\\agentlimb\.mjs/);
  assert.doesNotMatch(installer, /sourceManifest/);
  assert.match(installer, /agentlimb-bridge\.error\.log/);
  assert.match(installer, /Microsoft\\Edge\\NativeMessagingHosts/);
  assert.match(installer, /BraveSoftware\\Brave-Browser\\NativeMessagingHosts/);
  assert.match(installer, /Chromium\\NativeMessagingHosts/);
  assert.match(installer, /Vivaldi\\NativeMessagingHosts/);
  assert.match(installer, /Opera Software\\NativeMessagingHosts/);
  assert.match(installer, /Yandex\\YandexBrowser\\NativeMessagingHosts/);
  assert.match(installer, /\[Alias\('ChromeExtensionId'\)\]/);
  assert.match(installer, /agentlimb-native-host\.exe/);
  assert.match(installer, /\\csc\.exe/);
});

test('side panel uses the platform-independent AgentLimb Runtime command', async () => {
  const sidePanel = await read('ui/sidepanel/sidepanel.js');
  assert.match(sidePanel, /return 'agentlimb';/);
  assert.doesNotMatch(sidePanel, /LOCALAPPDATA\\\\AgentLimb\\\\bin/);
  assert.doesNotMatch(sidePanel, /~\/\.agentlimb\/bin\/agentlimb/);
  assert.match(sidePanel, /agentlimb_project_path_source/);
  assert.match(sidePanel, /storedSource === 'manual'/);
  assert.match(sidePanel, /meta\.browserName/);
  assert.match(sidePanel, /Microsoft Edge/);
  assert.match(sidePanel, /navigator\.userAgentData\?\.brands/);
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
  assert.match(uninstaller, /BraveSoftware\\Brave-Browser\\NativeMessagingHosts/);
  assert.match(uninstaller, /Muscle files.*preserved/);
});

test('macOS installer registers the Native Messaging host for supported Chromium browsers', async () => {
  const installer = await read('scripts/install.sh');
  assert.match(installer, /Google\/Chrome\/NativeMessagingHosts/);
  assert.match(installer, /Microsoft Edge\/NativeMessagingHosts/);
  assert.match(installer, /BraveSoftware\/Brave-Browser\/NativeMessagingHosts/);
  assert.match(installer, /Chromium\/NativeMessagingHosts/);
  assert.match(installer, /Vivaldi\/NativeMessagingHosts/);
  assert.match(installer, /Arc\/NativeMessagingHosts/);
  assert.match(installer, /com\.operasoftware\.Opera\/NativeMessagingHosts/);
  assert.match(installer, /Chromium browser extensions page/);
  assert.match(installer, /AgentLimb Runtime archive is incomplete/);
  assert.match(installer, /\$INSTALL_ROOT\/bin\/agentlimb\.mjs/);
  assert.doesNotMatch(installer, /SOURCE_MANIFEST/);
});
