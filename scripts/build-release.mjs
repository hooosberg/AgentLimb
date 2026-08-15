#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, '忽略上传', 'dist');
const packagePath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'manifest.json');
const constantsPath = path.join(rootDir, 'kernel', 'shared', 'constants.js');
const websiteDir = path.join(rootDir, 'website');

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVersion(value) {
  const version = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`Invalid version "${value}". Expected x.y.z.`);
  }
  return version;
}

function normalizeBuildLabel(value) {
  const build = String(value || '').trim().toLowerCase();
  if (!/^b\d+$/.test(build)) {
    fail(`Invalid build label "${value}". Expected b<number>, such as b1.`);
  }
  return build;
}

function replaceOrFail(file, pattern, replacement) {
  const input = fs.readFileSync(file, 'utf8');
  if (!pattern.test(input)) fail(`Expected version marker was not found in ${path.relative(rootDir, file)}.`);
  pattern.lastIndex = 0;
  fs.writeFileSync(file, input.replace(pattern, replacement));
}

function replaceIfPresent(file, pattern, replacement) {
  const input = fs.readFileSync(file, 'utf8');
  pattern.lastIndex = 0;
  if (pattern.test(input)) {
    pattern.lastIndex = 0;
    fs.writeFileSync(file, input.replace(pattern, replacement));
  }
}

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function zip(directoryName, outputName, { contentsOnly = false } = {}) {
  const cwd = contentsOnly ? path.join(distDir, directoryName) : distDir;
  const args = contentsOnly
    ? ['-qry', path.join('..', outputName), '.']
    : ['-qry', outputName, directoryName];
  const result = spawnSync('zip', args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    fail('Could not create zip archives. Install the zip command and retry.');
  }
}

const currentPackage = readJson(packagePath);
const version = normalizeVersion(process.argv[2] || currentPackage.version);
const buildLabel = normalizeBuildLabel(process.argv[3] || currentPackage.agentlimbBuild);
const releaseVersion = `${version}-${buildLabel}`;
const extensionBase = `agentlimb-chrome-v${releaseVersion}`;
const extensionAsset = `${extensionBase}.zip`;

currentPackage.version = version;
currentPackage.agentlimbBuild = buildLabel;
writeJson(packagePath, currentPackage);
const manifest = readJson(manifestPath);
manifest.version = version;
writeJson(manifestPath, manifest);
replaceOrFail(constantsPath, /export const APP_VERSION = '[^']+';/, `export const APP_VERSION = '${version}';`);
replaceOrFail(constantsPath, /export const APP_BUILD = '[^']+';/, `export const APP_BUILD = '${buildLabel}';`);

for (const file of [
  path.join(rootDir, 'README.md'),
  ...fs.readdirSync(path.join(rootDir, 'readme-locales')).filter((name) => name.endsWith('.md')).map((name) => path.join(rootDir, 'readme-locales', name)),
  path.join(websiteDir, 'index.html'),
]) {
  replaceIfPresent(file, /releases\/download\/v\d+\.\d+\.\d+\//g, `releases/download/v${version}/`);
  replaceIfPresent(file, /agentlimb-chrome-v\d+\.\d+\.\d+(?:-b\d+)?\.zip/g, extensionAsset);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const extensionDir = path.join(distDir, extensionBase);
fs.mkdirSync(extensionDir);
for (const name of ['_locales', 'icons', 'kernel', 'ui', 'manifest.json', 'package.json']) {
  copy(path.join(rootDir, name), path.join(extensionDir, name));
}
const extensionScriptsDir = path.join(extensionDir, 'scripts');
fs.mkdirSync(extensionScriptsDir);
for (const name of ['install.ps1', 'install.sh', 'native-host.mjs']) {
  copy(path.join(rootDir, 'scripts', name), path.join(extensionScriptsDir, name));
}
copy(path.join(rootDir, 'scripts', 'windows'), path.join(extensionScriptsDir, 'windows'));
fs.rmSync(path.join(extensionDir, 'kernel', '.mvp-terminal-session.json'), { force: true });
zip(extensionBase, extensionAsset, { contentsOnly: true });

fs.rmSync(extensionDir, { recursive: true, force: true });

const checksumLines = [extensionAsset].map((name) => {
  const digest = createHash('sha256').update(fs.readFileSync(path.join(distDir, name))).digest('hex');
  return `${digest}  ${name}`;
});
fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`);

console.log(`[release] AgentLimb v${releaseVersion}`);
console.log(`[release] ${path.relative(rootDir, path.join(distDir, extensionAsset))}`);
console.log('[release] 忽略上传/dist/SHA256SUMS.txt');
