#!/usr/bin/env node
/**
 * 网站记忆真实模型冒烟（不依赖浏览器）
 *
 * 验证的是这个机制的核心承诺：**一个真实的 AI，用真实的 MCP，真的把知识写进磁盘，
 * 然后一个全新的会话真的把它读回来。** 不采信模型自称"记住了"——每一步都由本脚本
 * 独立读磁盘校验。
 *
 *   node scripts/memory-smoke.mjs
 *   AGENTLIMB_TEST_MODEL=hy3 CZEN_PATH=~/bin/czen node scripts/memory-smoke.mjs
 *
 * 浏览器链路（配对 / 点击 / 输入）由 scripts/ai-onboarding-test.mjs 覆盖。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = mkdtempSync(join(tmpdir(), 'agentlimb-memory-'));
const home = join(work, 'home');
const notes = join(work, 'notes');
const configFile = join(work, 'mcp.json');
const model = process.env.AGENTLIMB_TEST_MODEL || 'hy3';
const czen = process.env.CZEN_PATH || join(homedir(), 'bin/czen');
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`${name}: ${detail}`);
}

function run(cmd, args, { env = {}, cwd = root, timeout = 240000 } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeout);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function agent(stage, prompt) {
  const env = {
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    ZEN_GATE_HOME: process.env.ZEN_GATE_HOME || join(homedir(), 'Library/Application Support/zen-gate'),
  };
  delete env.AGENTLIMB_CLIENT_NAME;
  const child = spawn(czen, [
    model, '--bare', '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--strict-mcp-config', '--mcp-config', configFile,
    '--tools', '', '--allowedTools', 'mcp__agentlimb__*',
    '--no-session-persistence', '--max-turns', '12',
    '--append-system-prompt', `This is an authorized isolated software test. Everything you write must stay inside ${work}. Do not access real user configuration or credentials. Do not use subagents.`,
  ], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    const value = String(chunk);
    stdout += value;
    for (const line of value.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant') {
          for (const part of event.message?.content || []) {
            if (part.type === 'tool_use') console.log(`[${stage}] tool ${part.name} ${JSON.stringify(part.input).slice(0, 120)}`);
            if (part.type === 'text' && part.text.trim()) console.log(`[${stage}] ${part.text.trim().slice(0, 200)}`);
          }
        }
      } catch { /* partial line */ }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${stage} exceeded 4 minutes`)); }, 240000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      writeFileSync(join(work, `${stage}.jsonl`), stdout);
      writeFileSync(join(work, `${stage}.stderr.log`), stderr);
      resolve({ code, stdout, stderr });
    });
  });
}

try {
  mkdirSync(home, { recursive: true });
  console.log(`Model: ${model}\nEvidence: ${work}\n`);

  // 1. 安装：网站记忆应当是配对/安装的一部分，而不是另一件事。
  const install = await run(process.execPath, [
    'bin/agentlimb.mjs', 'install',
    '--client-name', 'Czen memory smoke', '--client-kind', 'czen-memory',
    '--memory-root', notes,
  ], { env: { HOME: home } });
  check('install_exit_0', install.code === 0, `exit=${install.code}`);
  check('install_announces_site_memory', /网站记忆/.test(install.stdout));
  check('memory_folder_seeded', existsSync(join(notes, '.agentlimb-kb')) && existsSync(join(notes, 'knowledge', 'sites')));
  // `config` prints nothing but JSON; `install` prints guidance around it.
  const configOut = await run(process.execPath, [
    'bin/agentlimb.mjs', 'config',
    '--client-name', 'Czen memory smoke', '--client-kind', 'czen-memory',
  ], { env: { HOME: home } });
  const config = JSON.parse(configOut.stdout);
  const entry = config.mcpServers?.agentlimb;
  check('mcp_config_points_at_installed_host', entry?.args?.[0] === join(home, '.agentlimb/host/mcp-server.mjs') && existsSync(entry.args[0]));
  writeFileSync(configFile, JSON.stringify(config, null, 2));

  // 2. 第一次真实会话：应该被告知有网站记忆，并且真的调用它。
  const first = await agent('write', [
    '你在做一次功能验收。用户接下来会让你操作 example.com 这个网站（发布一篇文章）。',
    '按你收到的规则处理：操作前先查这个网站的记忆，操作后把学到的东西写回去。',
    '本轮不需要真的打开浏览器，按"已经成功完成一次发布"处理，并给出可验证的成功证据。',
    '要求：使用 site_memory 工具；站点填 example.com；标题填 "Example 发布页"；',
    '入口填 "https://example.com/admin/publish"；步骤写清楚三步；锚点写 "#title → textarea#title → 页面唯一的标题框"；',
    '坑写 "点发布后会弹二次确认"；成功证据写 "出现 Published 提示"。',
    '最后用一句话汇报你做了什么。',
  ].join('\n'));
  check('first_session_exit_0', first.code === 0, `exit=${first.code}`);
  check('first_session_called_site_memory', /mcp__agentlimb__site_memory/.test(first.stdout), 'the tool must be discovered and used');
  check('first_session_briefed_first', /"action":"brief"/.test(first.stdout), 'brief must come before the work');
  check('first_session_recorded', /"action":"record"/.test(first.stdout));

  const playbookFile = join(notes, 'knowledge/sites/example.com/PLAYBOOK.md');
  check('playbook_written_by_the_model', existsSync(playbookFile));
  const playbook = existsSync(playbookFile) ? readFileSync(playbookFile, 'utf8') : '';
  check('playbook_has_direct_entry', playbook.includes('https://example.com/admin/publish'));
  check('playbook_has_selector_and_pitfall', /#title/.test(playbook) && /二次确认/.test(playbook));
  check('playbook_marked_verified', /status: verified/.test(playbook));
  check('playbook_stores_no_secrets', !/(password|passwd|cookie|authorization|bearer|token)/i.test(playbook));
  const sessionsDir = join(notes, 'knowledge/sites/example.com/sessions');
  const sessions = existsSync(sessionsDir) ? readdirSync(sessionsDir).length : 0;
  check('run_logged', sessions >= 1, `${sessions} session file(s)`);

  // 3. 全新会话：这才是"下次不用摸索"。模型必须从磁盘读回来，不能凭印象。
  const second = await agent('reuse', [
    '这是一个全新的对话，你没有上一轮的上下文。',
    '用户要你在 example.com 上再发一篇文章。先查这个网站的记忆，然后原样复述你读到的：',
    '1) 直达入口 URL 2) 标题框的选择器 3) 发布时的坑。',
    '只复述工具返回的内容；如果工具说没有记录，就回答 NO_PLAYBOOK。',
  ].join('\n'));
  check('second_session_exit_0', second.code === 0, `exit=${second.code}`);
  check('second_session_read_existing_playbook', /PLAYBOOK: example\.com/.test(second.stdout), 'a fresh session must get the record back');
  check('second_session_got_the_entry_url', second.stdout.includes('https://example.com/admin/publish'));
  check('second_session_got_the_selector', /#title/.test(second.stdout));

  // 4. 关闭开关：提示词消失，工具明确拒绝写入。
  const off = await run(process.execPath, ['bin/agentlimb.mjs', 'memory', '--no-memory'], { env: { HOME: home } });
  check('memory_off_command_works', off.code === 0 && /"enabled": false/.test(off.stdout));
  const disabled = await agent('disabled', '调用一次 site_memory {action:"status"}，把工具返回的内容原样复述。');
  check('disabled_tool_says_so', /DISABLED/.test(disabled.stdout), 'the tool must refuse instead of writing');
} catch (error) {
  console.error(error.stack || error.message);
  results.push({ name: 'fatal', ok: false, detail: error.message });
} finally {
  const keep = process.env.AGENTLIMB_TEST_KEEP === '1';
  writeFileSync(join(work, 'summary.json'), JSON.stringify({ model, results }, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nFinal ${passed}/${results.length}; ${work}/summary.json`);
  if (!keep) console.log('（加 AGENTLIMB_TEST_KEEP=1 可保留现场）');
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
