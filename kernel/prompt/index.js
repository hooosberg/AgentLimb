/**
 * AgentLimb Prompt Module
 *
 * Dynamically generates the connection prompt for AI terminals.
 * This prompt IS the plugin's external interface — any AI terminal
 * reads it and can immediately connect and operate the browser.
 *
 * Fixed sections (auto-generated from plugin state):
 *   identity  — what this plugin is, where the host lives
 *   protocol  — how to connect (lifecycle commands)
 *   tools     — full tool catalog (from HOST_TOOLS, single source of truth)
 *   rules     — behavioral constraints
 *
 * Dynamic sections (injected by caller):
 *   changes   — development changelog (test focus)
 *   mission   — user's task prompt
 */

import { buildIdentitySection } from './identity.js';
import { buildProtocolSection } from './protocol.js';
import { buildToolsSection } from './tools.js';
import { buildRulesSection } from './rules.js';
import { buildMinimalPrompt } from './minimal.js';

/**
 * Build the complete terminal prompt.
 *
 * @param {Object} ctx
 * @param {string}  ctx.hostBaseUrl       — HTTP host address
 * @param {string}  ctx.clientCommand     — Terminal client CLI command
 * @param {string} [ctx.projectDir]       — Absolute path to project root (embedded in prompt)
 * @param {string} [ctx.terminalName]     — Display name (default: "Terminal")
 * @param {string} [ctx.terminalType]     — Type identifier (default: "codex")
 * @param {string} [ctx.appName]          — Override plugin name
 * @param {string} [ctx.appVersion]       — Override plugin version
 * @param {string} [ctx.taskId]           — Pre-assigned task ID (empty = auto)
 * @param {string} [ctx.mission]          — User's task / prompt text
 * @param {string} [ctx.changes]          — Development changelog for test focus
 * @param {boolean} [ctx.compact]         — Omit startup/install boilerplate (Bridge + extension already online)
 * @param {boolean} [ctx.bridgeOnline]    — Bridge is confirmed online (skips startup section in compact mode)
 * @param {boolean} [ctx.extensionOnline] — Extension is confirmed online (injected at copy-time; panel open = extension running)
 * @param {string}  [ctx.platform]        — OS/platform name detected at copy-time (e.g. "macOS", "Windows", "Linux")
 * @param {string}  [ctx.platformArch]    — CPU architecture (e.g. "arm64", "x86-64")
 * @param {string}  [ctx.platformVersion] — OS version string (e.g. "14.5")
 * @param {string}  [ctx.languages]       — Browser language preferences (e.g. "zh-CN / en-US")
 * @param {string}  [ctx.extensionId]     — Chrome extension ID
 * @param {number}  [ctx.muscleCount]     — Number of learned site profiles
 * @param {'full'|'minimal'} [ctx.mode]   — Prompt verbosity. 'minimal' ~45 lines (Bridge online); 'full' complete (default)
 * @returns {string} Complete markdown prompt
 */
export function buildPrompt(ctx = {}) {
  if (ctx.mode === 'minimal') {
    return buildMinimalPrompt(ctx);
  }

  // In compact mode (Bridge + extension known-online), put mission first so AI
  // reads what it needs to do before reading HOW to connect.
  const isCompact = Boolean(ctx.compact);

  const sections = [];

  if (isCompact && ctx.mission) {
    sections.push(buildMissionSection(ctx));
  }

  sections.push(buildIdentitySection(ctx));
  sections.push(buildProtocolSection(ctx));
  sections.push(buildToolsSection(ctx));
  sections.push(buildRulesSection(ctx));

  if (ctx.changes) {
    sections.push(buildChangesSection(ctx));
  }

  if (!isCompact && ctx.mission) {
    sections.push(buildMissionSection(ctx));
  }

  sections.push(buildCallToAction(ctx));

  return sections.join('\n\n');
}

function buildCallToAction(ctx) {
  const cmd = ctx.clientCommand || 'terminal-client';
  const bridgeOnline    = Boolean(ctx.bridgeOnline);
  const extensionOnline = Boolean(ctx.extensionOnline);

  if (bridgeOnline && extensionOnline) {
    return `---\n**Start now**: the Bridge and extension are both ready — run \`${cmd} start\` directly, then operate the browser according to the mission. No user confirmation needed, just execute.`;
  }

  if (extensionOnline) {
    return `---\n**Start now**: follow Step 0. If the local runtime is not installed, obtain explicit user approval before making system changes; otherwise confirm the Bridge is online, run \`${cmd} start\`, and operate the browser according to the mission.`;
  }

  return `---\n**Start now**: follow Step 0 to confirm the Bridge is online and the extension is connected. Obtain explicit user approval before any local-runtime installation, then run \`${cmd} start\` and operate the browser according to the mission.`;
}

function buildChangesSection({ changes }) {
  return [
    '## Changes in this round (testing focus)',
    '',
    changes,
    '',
    'Arrange testing around these changes. Features related to the changes must be covered; other features can be exercised naturally as the mission requires.',
  ].join('\n');
}

function buildMissionSection({ mission }) {
  return ['## Mission', '', mission].join('\n');
}
