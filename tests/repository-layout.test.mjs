import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('public source versions stay synchronized', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const manifest = JSON.parse(await read('manifest.json'));
  const constants = await read('kernel/shared/constants.js');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.agentlimbBuild, /^b\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.match(constants, new RegExp(`APP_VERSION = '${pkg.version.replaceAll('.', '\\.')}'`));
  assert.match(constants, new RegExp(`APP_BUILD = '${pkg.agentlimbBuild}'`));
});

test('website and open-source metadata are in the public root', async () => {
  await Promise.all([
    access(new URL('website/index.html', root)),
    access(new URL('docs/development/README.md', root)),
    access(new URL('LICENSE', root)),
    access(new URL('SECURITY.md', root)),
    access(new URL('CONTRIBUTING.md', root)),
    access(new URL('.github/workflows/ci.yml', root)),
    access(new URL('.github/workflows/release.yml', root)),
  ]);
});

test('release output and common credential files are ignored', async () => {
  const ignore = await read('.gitignore');
  assert.match(ignore, /^\/忽略上传\/$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\*\.pem$/m);
  assert.match(ignore, /^credentials\/$/m);
});

test('website does not publish local muscle execution records', async () => {
  await assert.rejects(access(new URL('website/content/muscles', root)), { code: 'ENOENT' });
});

test('release builder publishes extension and GitHub-bootstrap Runtime assets', async () => {
  const builder = await read('scripts/build-release.mjs');
  assert.match(builder, /normalizeBuildLabel/);
  assert.match(builder, /const releaseVersion = `\$\{version\}-\$\{buildLabel\}`/);
  assert.match(builder, /const runtimeBase = `agentlimb-runtime-v\$\{releaseVersion\}`/);
  assert.match(builder, /const checksumLines = \[extensionAsset, runtimeAsset\]/);
  assert.match(builder, /\.mvp-terminal-session\.json/);
  assert.doesNotMatch(builder, /agentlimb-windows-v/);
});
