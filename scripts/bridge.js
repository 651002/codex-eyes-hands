#!/usr/bin/env node
/* codex-bridge — one-command wrapper around the local Codex CLI (eyes/hands).
 * Modes:
 *   see  <img...> [--ask Q]              vision analysis (multiple images = compare)
 *   read <path> [--ask Q]                archive / folder / special-format inspection
 *   ask  "<question>"                    resume the latest codex session (follow-up, saves tokens)
 *   gen  "<description>" [--out <dir>]   image generation
 *   hands <browser|computer> "<task>"    GUI / browser automation (permission-gated)
 *   watch "<task>" [--rules R]           SUPERVISED run: start codex in background with guardrails,
 *                                        streaming JSONL events to a file for the supervisor to poll
 *   status                               show current watch state (alive? event count? last event)
 *   events [N]                           print the last N summarized watch events
 *   stop                                 kill the watched codex process
 *   steer "<correction>"                 stop (if running) and resume the same session with a correction
 * Options: --effort low|medium|high  --model M  --timeout SEC  --workspace DIR  --rules R  --tail N
 */
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VISION_PROMPT = '仔细看这张图：详细描述画面内容，逐字转写所有可见文字（标题、正文、按钮、代码、数字、菜单等）；如果是图表/流程图/UI/文档，说明其结构和数据。不要调用任何工具或执行命令，直接输出分析结果。';
const READ_PROMPT = '请自己想办法查看这个目标（解压压缩包、列目录、读取文本、必要时转换格式或提取二进制里的字符串），用中文总结：1) 里面有什么（文件清单/结构）；2) 重点内容。可以做只读性质的 shell 操作，不要修改原文件、不要做破坏性操作。最后直接输出总结。';

const DEFAULT_RULES = [
  '只在任务指定的范围内操作，不要动范围外的任何文件。',
  '不得删除、覆盖任何已有文件；不得修改系统设置；不得安装软件。',
  '任何删除/覆盖/系统修改/安装类动作，必须先停下来，说明理由并等待监督者批准。',
  '先输出 1-3 行计划再动手；每完成一步，用一句话报告进度。',
  '同一个报错不要用同一种方式重试超过两次；换个思路，或报告卡点。'
].join('\n');

const HELP = `codex-bridge — 调用本机 Codex CLI 当眼睛和手

用法: node bridge.js <模式> [参数...] [选项]

模式:
  see   <图片路径...> [--ask "用户问题"]  看图 / 多图对比
  read  <路径> [--ask "用户问题"]         解读压缩包/文件夹/特殊格式
  ask   "<追问>"                          复用上一个 codex 会话追问（省 token）
  gen   "<画什么的描述>" [--out <目录>]   生成图片
  hands <browser|computer> "<任务>"       浏览器/GUI 操作（权限受限，半通）
  watch "<任务>" [--rules "<额外红线>"]   监督模式：后台启动 codex，事件流写入文件供监督
  status                                 查看 watch 状态（是否存活/事件数/最后一条）
  events [N]                             打印 watch 最近 N 条事件摘要（默认 15）
  stop                                   喊停 watch（杀掉 codex 进程）
  steer "<纠正指令>"                     停（若在跑）+ 用纠正指令续跑同一会话
  shot ["问题"]                          截当前屏幕 → 交给 codex 看图（默认问题：描述屏幕）
  fetch <url>                           抓取网页正文并总结
  search "<问题>"                        codex 官方联网搜索（带来源）
  clean [小时数]                         清理过期的临时图片/临时文件（默认阈值 24 小时）
  type "<文本>"                          向指定窗口键入文本（必须 --window，默认 3 秒延迟）
  key "<按键>"                           向指定窗口发送按键（SendKeys 语法，如 {ENTER} ^v；必须 --window）

选项:
  --effort minimal|low|medium|high|xhigh|max|ultra   思考强度，默认 ultra（最高档）
  --backup auto|only|off     备用通道（Claude）：auto=主通道失败自动切换（默认）/ only=只用备用 / off=关闭
  --delay <秒>               type/key 发送按键前的延迟，默认 3
  --window <标题开头或PID>    type/key 的目标窗口（必填；聚焦失败则取消发送）
  --model <模型id>           覆盖默认模型
  --timeout <秒>             超时，默认 300
  --workspace <目录>         指定 codex 工作目录
  --rules "<额外红线>"       追加到 watch 默认红线
  --tail <N>                 events 模式的条数
`;

function parseArgs(argv) {
  const opts = { effort: 'ultra', backup: 'auto', delay: undefined, window: undefined, model: undefined, timeout: 300, workspace: undefined, ask: undefined, outDir: undefined, rules: undefined, tail: undefined };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--effort') opts.effort = argv[++i];
    else if (a === '--backup') opts.backup = argv[++i];
    else if (a === '--delay') opts.delay = Number(argv[++i]);
    else if (a === '--window') opts.window = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--workspace') opts.workspace = argv[++i];
    else if (a === '--ask') opts.ask = argv[++i];
    else if (a === '--out') opts.outDir = argv[++i];
    else if (a === '--rules') opts.rules = argv[++i];
    else if (a === '--tail') opts.tail = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else positionals.push(a);
  }
  return { mode: positionals[0], positionals: positionals.slice(1), opts };
}

function codexEntry() {
  const c = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return fs.existsSync(c) ? c : null;
}

/** Download an http(s) image to a local temp file so codex can attach it. */
function localizeImage(p) {
  if (!/^https?:\/\//i.test(p)) return p;
  let ext = '.png';
  try { ext = path.extname(new URL(p).pathname) || '.png'; } catch { /* keep png */ }
  const dest = path.join(os.tmpdir(), `codex-bridge-dl-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  const r = spawnSync('curl.exe', ['-sL', '--max-time', '60', p, '-o', dest], { stdio: 'ignore', windowsHide: true });
  if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  try { fs.unlinkSync(dest); } catch { /* ignore */ }
  return p;
}

// ---------------- sync modes (see/read/ask/gen/hands/steer) ----------------

function buildPrompt(mode, positionals, opts) {
  if (mode === 'see') {
    let p = positionals.length > 1
      ? `请对比分析这 ${positionals.length} 张图片：先逐张描述，再总结它们的异同。\n${VISION_PROMPT}`
      : VISION_PROMPT;
    if (opts.ask) p += `\n\n用户想问：${opts.ask}`;
    return p;
  }
  if (mode === 'read') {
    const targets = positionals.map((p) => `- ${p}`).join('\n');
    let p = `目标（${positionals.length} 个）：\n${targets}\n${READ_PROMPT}`;
    if (opts.ask) p += `\n\n用户想问：${opts.ask}`;
    return p;
  }
  if (mode === 'gen') {
    let p = positionals.join(' ');
    if (opts.outDir) {
      p += `\n\n请把生成的图片保存为 ${path.join(opts.outDir, `codex-gen-${Date.now()}.png`)}，完成后只回复保存的绝对路径。`;
    }
    return p;
  }
  return positionals.join(' '); // ask / hands / steer
}

function buildArgs(mode, positionals, opts) {
  const effort = ['-c', `model_reasoning_effort="${opts.effort}"`];
  const prompt = buildPrompt(mode, positionals, opts);
  switch (mode) {
    case 'see':
      return ['exec', prompt, ...positionals.flatMap((p) => ['-i', localizeImage(p)]), '-s', 'read-only', '--skip-git-repo-check', '--color', 'never', ...effort];
    case 'read': {
      const cwd = opts.workspace || path.dirname(path.resolve(positionals[0]));
      return ['exec', prompt, '-C', cwd, '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', ...effort];
    }
    case 'gen':
      return ['exec', prompt, '--enable', 'image_generation', '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', ...effort];
    case 'ask': {
      const tid = readLastThread();
      if (tid) return ['exec', 'resume', tid, prompt, '--skip-git-repo-check', ...effort];
      return ['exec', 'resume', '--last', prompt, '--skip-git-repo-check', ...effort];
    }
    case 'hands': {
      const backend = positionals[0] === 'computer' ? 'computer_use' : 'browser_use';
      return ['exec', prompt, '--enable', backend, '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', ...effort];
    }
    default:
      throw new Error(`unknown mode: ${mode}`);
  }
}

function execOnce(args, opts, extraEnv) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const outFile = path.join(os.tmpdir(), `codex-bridge-out-${stamp}.txt`);
  const errFile = path.join(os.tmpdir(), `codex-bridge-err-${stamp}.log`);
  const evFile = path.join(os.tmpdir(), `codex-bridge-ev-${stamp}.jsonl`);
  const full = [...args, '--json', '-o', outFile];
  if (opts.model) full.push('-m', opts.model);

  let errFd = -1;
  let evFd = -1;
  try { errFd = fs.openSync(errFile, 'w'); } catch { /* ignore */ }
  try { evFd = fs.openSync(evFile, 'w'); } catch { /* ignore */ }

  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  let res;
  const entry = codexEntry();
  if (entry) {
    res = spawnSync(process.execPath, [entry, ...full], { stdio: ['ignore', evFd, errFd], timeout: opts.timeout * 1000, windowsHide: true, env });
  } else {
    const cmdline = ['/d', '/s', '/c', 'codex', ...full].map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    res = spawnSync('cmd.exe', ['/d', '/s', '/c', cmdline], { stdio: ['ignore', evFd, errFd], timeout: opts.timeout * 1000, windowsHide: true, env });
  }
  if (errFd >= 0) { try { fs.closeSync(errFd); } catch { /* ignore */ } }
  if (evFd >= 0) { try { fs.closeSync(evFd); } catch { /* ignore */ } }

  let threadId = null;
  try {
    if (fs.existsSync(evFile)) {
      for (const line of fs.readFileSync(evFile, 'utf8').split(/\r?\n/)) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'thread.started' && ev.thread_id) { threadId = ev.thread_id; break; }
        } catch { /* skip */ }
      }
      fs.unlinkSync(evFile);
    }
  } catch { /* ignore */ }
  if (threadId) saveLastThread(threadId);

  let text = null;
  try {
    if (fs.existsSync(outFile)) { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile); }
  } catch { /* ignore */ }

  let errTail = '';
  try {
    if (fs.existsSync(errFile)) {
      const e = fs.readFileSync(errFile, 'utf8');
      errTail = e.split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
      fs.unlinkSync(errFile);
    }
  } catch { /* ignore */ }

  return { text, exit: res.status, signal: res.signal, errTail, threadId };
}

const LAST_THREAD_FILE = path.join(os.tmpdir(), 'codex-bridge-last-thread.txt');
function saveLastThread(id) {
  try { fs.writeFileSync(LAST_THREAD_FILE, String(id), 'utf8'); } catch { /* ignore */ }
}
function readLastThread() {
  try {
    const v = fs.readFileSync(LAST_THREAD_FILE, 'utf8').trim();
    return v || null;
  } catch { return null; }
}

/** Read the working Claude backup key from the CC Switch database (织境 claude 通道). */
function readClaudeKey() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
    if (!fs.existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const codexKeys = new Set();
    for (const r of db.prepare("SELECT settings_config FROM providers WHERE app_type='codex'").all()) {
      try { const c = JSON.parse(r.settings_config); const k = c.auth?.OPENAI_API_KEY; if (k) codexKeys.add(k); } catch { /* skip */ }
    }
    let claudeKey = null;
    for (const r of db.prepare("SELECT settings_config FROM providers WHERE app_type='claude'").all()) {
      try {
        const c = JSON.parse(r.settings_config);
        const k = c.env?.ANTHROPIC_AUTH_TOKEN;
        if (typeof k === 'string' && k.startsWith('sk-') && !codexKeys.has(k)) { claudeKey = k; break; }
      } catch { /* skip */ }
    }
    db.close();
    return claudeKey;
  } catch {
    return null;
  }
}

/** Rewrite args for the Claude backup: drop the effort override, layer the claude profile. */
function claudeArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && args[i + 1] && args[i + 1].startsWith('model_reasoning_effort=')) { i++; continue; }
    out.push(args[i]);
  }
  const isResume = out[0] === 'exec' && out[1] === 'resume';
  if (isResume) {
    // resume 不支持 -p 配置文件，改用 -c 覆盖 provider/model/effort
    out.push('-c', 'model_provider="claude"', '-c', 'model="claude-sonnet-5"', '-c', 'model_reasoning_effort="high"');
  } else {
    const execIdx = out.indexOf('exec');
    if (execIdx >= 0) out.splice(execIdx + 1, 0, '-p', 'claude');
  }
  return out;
}

function runCodexSync(args, opts) {
  const backup = opts.backup || 'auto';
  if (backup === 'only') {
    const key = readClaudeKey();
    if (!key) return { text: null, exit: -1, signal: null, errTail: '[codex-bridge] 无法读取 Claude 备用 key（cc-switch.db）' };
    const r = execOnce(claudeArgs(args), opts, { ANTHROPIC_AUTH_TOKEN: key });
    if (r.text) { r.text = '[备用通道: claude-sonnet-5]\n' + r.text; r.via = 'claude-backup'; }
    return r;
  }
  const primary = execOnce(args, opts, undefined);
  if (primary.text || backup === 'off') return primary;
  const key = readClaudeKey();
  if (!key) return primary;
  const r2 = execOnce(claudeArgs(args), opts, { ANTHROPIC_AUTH_TOKEN: key });
  if (r2.text) { r2.text = '[主通道失败，已自动切换备用通道: claude-sonnet-5]\n' + r2.text; r2.via = 'claude-backup'; return r2; }
  return primary;
}

// ---------------- watch machinery (supervised mode) ----------------

const STATE_FILE = path.join(os.tmpdir(), 'codex-bridge-watch-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function watchTaskTemplate(task, rules) {
  return `你是受监督的执行者。请完成以下任务：

任务：${task}

监督者红线（必须遵守）：
${rules}

工作方式：
1. 先用 1-3 行列出计划。
2. 逐步执行，每完成一步用一句话报告进度。
3. 遇到需要删除/覆盖/改系统设置/安装的情况，停下来说明并等待批准。
4. 任务完成后，输出一段总结：做了什么、结果在哪、有没有异常。`;
}

function watchTask(task, rules, opts) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const eventsFile = path.join(os.tmpdir(), `codex-bridge-watch-${stamp}.jsonl`);
  const errFile = path.join(os.tmpdir(), `codex-bridge-watch-${stamp}.err.log`);
  const outFile = path.join(os.tmpdir(), `codex-bridge-watch-${stamp}.out.txt`);
  const prompt = watchTaskTemplate(task, rules || DEFAULT_RULES);
  const args = ['exec', prompt, '--json', '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-c', `model_reasoning_effort="${opts.effort}"`, '-o', outFile];
  if (opts.workspace) args.push('-C', opts.workspace);
  if (opts.model) args.push('-m', opts.model);

  const outFd = fs.openSync(eventsFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  const entry = codexEntry();
  let env = process.env;
  let finalArgs = args;
  if (opts.backup === 'only') {
    const key = readClaudeKey();
    if (key) { finalArgs = claudeArgs(args); env = { ...process.env, ANTHROPIC_AUTH_TOKEN: key }; }
  }
  const child = spawn(process.execPath, [entry, ...finalArgs], { stdio: ['ignore', outFd, errFd], detached: true, windowsHide: true, env });
  child.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  const state = {
    pid: child.pid,
    threadId: null,
    eventsFile,
    errFile,
    outFile,
    startedAt: new Date().toISOString(),
    task,
    rules: rules || DEFAULT_RULES,
    effort: opts.effort,
    stopped: false
  };
  writeState(state);

  // wait briefly for the thread id to appear in the event stream
  const sab = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && !state.threadId) {
    Atomics.wait(sab, 0, 0, 400);
    try {
      if (fs.existsSync(eventsFile)) {
        const lines = fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'thread.started' && ev.thread_id) { state.threadId = ev.thread_id; break; }
          } catch { /* skip partial line */ }
        }
      }
    } catch { /* ignore */ }
  }
  writeState(state);
  console.log(`watch 已启动: pid=${child.pid} thread=${state.threadId || '(未获取到)'}`);
  console.log(`events: ${eventsFile}`);
  console.log(`state:  ${STATE_FILE}`);
}

function showStatus() {
  const s = readState();
  if (!s) { console.log('没有进行中的 watch'); return; }
  const alive = !s.stopped && isAlive(s.pid);
  let count = 0;
  let last = '';
  let hasResult = false;
  try {
    if (fs.existsSync(s.eventsFile)) {
      const lines = fs.readFileSync(s.eventsFile, 'utf8').split(/\r?\n/).filter(Boolean);
      count = lines.length;
      if (lines.length) last = summarizeEventSafe(lines[lines.length - 1]);
    }
    if (fs.existsSync(s.outFile) && fs.readFileSync(s.outFile, 'utf8').trim()) hasResult = true;
  } catch { /* ignore */ }
  console.log(`pid=${s.pid} alive=${alive} thread=${s.threadId || '-'} events=${count} result=${hasResult} started=${s.startedAt}`);
  if (last) console.log(`last: ${last}`);
}

function summarizeEventSafe(line) {
  try { return summarizeEvent(JSON.parse(line)); } catch { return line.length > 200 ? line.slice(0, 200) + '…' : line; }
}

function summarizeEvent(ev) {
  const it = ev.item;
  if (ev.type === 'thread.started') return `▶ 线程启动 ${ev.thread_id}`;
  if (ev.type === 'turn.started') return '▶ 新回合开始';
  if (it) {
    if (it.type === 'command_execution') {
      const out = it.aggregated_output ? String(it.aggregated_output).slice(0, 120).replace(/\s+/g, ' ') : '';
      return `⚙ 命令: ${it.command}${out ? ` → ${out}` : ''}`;
    }
    if (it.type === 'mcp_tool_call') return `🛠 工具: ${it.server}.${it.tool} ${JSON.stringify(it.arguments || {}).slice(0, 120)}`;
    if (it.type === 'agent_message') return `💬 ${String(it.text).slice(0, 200)}`;
    if (it.type === 'error') return `⚠ 错误: ${String(it.message).slice(0, 200)}`;
    return `• ${ev.type} / ${it.type} ${it.id || ''}`;
  }
  if (ev.type === 'error') return `⚠ 错误: ${String(ev.message).slice(0, 200)}`;
  return `• ${ev.type}`;
}

function showEvents(n) {
  const s = readState();
  if (!s) { console.log('没有 watch 状态'); return; }
  if (!fs.existsSync(s.eventsFile)) { console.log('事件文件还没生成'); return; }
  const lines = fs.readFileSync(s.eventsFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const take = lines.slice(-Math.max(1, n || 15));
  for (const line of take) console.log(summarizeEventSafe(line));
  console.log(`[共 ${lines.length} 条事件]`);
}

function stopWatch() {
  const s = readState();
  if (!s) { console.log('没有进行中的 watch'); return; }
  if (!s.stopped && isAlive(s.pid)) {
    const r = spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    console.log(`stop 已执行（pid=${s.pid}, taskkill exit=${r.status}）`);
  } else {
    console.log(`watch 进程已不在运行（pid=${s.pid}）`);
  }
  s.stopped = true;
  writeState(s);
}

function steerWatch(correction, opts) {
  const s = readState();
  if (!s) { console.log('没有 watch 状态（无法纠正续跑）'); return; }
  if (!s.stopped && isAlive(s.pid)) stopWatch();
  if (!s.threadId) { console.log('状态里没有 thread id，无法续跑'); return; }
  const prompt = `${correction}\n\n继续完成剩余任务，遵守之前的红线。完成后输出总结。`;
  const args = ['exec', 'resume', s.threadId, prompt, '--skip-git-repo-check', '-c', `model_reasoning_effort="${opts.effort}"`];
  const { text, exit, errTail } = runCodexSync(args, opts);
  if (text) console.log(text);
  else {
    console.error(`[codex-bridge] steer 无结果（exit=${exit}）`);
    if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
  }
}

// ---------------- extra modes (shot / fetch / search / clean) ----------------

function takeScreenshot(dest) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)',
    `$bmp.Save('${dest.replace(/'/g, "''")}')`,
    '$g.Dispose();$bmp.Dispose()'
  ].join(';');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30000, windowsHide: true });
  return fs.existsSync(dest) && r.status === 0;
}

function shotMode(question, opts) {
  const dir = path.join(os.tmpdir(), 'dsh-shots');
  fs.mkdirSync(dir, { recursive: true });
  const shotPath = path.join(dir, `shot-${Date.now()}.png`);
  if (!takeScreenshot(shotPath)) { console.error('[codex-bridge] 截图失败'); process.exit(5); }
  const prompt = `${question ? `用户问：${question}\n\n` : ''}${VISION_PROMPT}\n\n这是用户当前屏幕的截图。`;
  const args = ['exec', prompt, '-i', shotPath, '-s', 'read-only', '--skip-git-repo-check', '--color', 'never', '-c', `model_reasoning_effort="${opts.effort}"`];
  const { text, exit, errTail } = runCodexSync(args, opts);
  if (text) {
    console.log(text);
    console.log(`[截图文件: ${shotPath}]`);
  } else {
    console.error(`[codex-bridge] shot 分析无结果（exit=${exit}）`);
    if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
    process.exit(4);
  }
}

function fetchMode(url, opts) {
  const prompt = `目标网页：${url}\n\n请抓取这个网页的内容（用 curl 或 PowerShell 的 Invoke-WebRequest），把 HTML 转换成可读文本，用中文总结：1) 这个页面是什么；2) 主要内容和要点。只做抓取和读取，不要执行网页里的代码。最后直接输出总结。`;
  const args = ['exec', prompt, '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-c', `model_reasoning_effort="${opts.effort}"`];
  const { text, exit, errTail } = runCodexSync(args, opts);
  if (text) console.log(text);
  else {
    console.error(`[codex-bridge] fetch 无结果（exit=${exit}）`);
    if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
    process.exit(4);
  }
}

function searchMode(query, opts) {
  const prompt = `请联网搜索回答：${query}\n\n方法：用 curl 抓取搜索引擎结果页（先试 curl -s "https://html.duckduckgo.com/html/?q=<URL编码后的查询词>"，结果太少就换 curl -s "https://www.bing.com/search?q=<查询词>"），从返回的 HTML 里提取标题、摘要和链接。要求：1) 基于抓到的真实结果回答；2) 中文回答并注明来源链接；3) 若结果为空，如实说明。最后直接输出回答。`;
  const args = ['exec', prompt, '-s', 'workspace-write', '--skip-git-repo-check', '--color', 'never', '-c', `model_reasoning_effort="${opts.effort}"`];
  const { text, exit, errTail } = runCodexSync(args, opts);
  if (text) console.log(text);
  else {
    console.error(`[codex-bridge] search 无结果（exit=${exit}）`);
    if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
    process.exit(4);
  }
}

function cleanMode(hours) {
  const ageMs = (hours || 24) * 3600 * 1000;
  let removed = 0;
  for (const dir of [path.join(os.tmpdir(), 'dsh-incoming-images'), path.join(os.tmpdir(), 'dsh-shots')]) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          if (st.isFile() && Date.now() - st.mtimeMs > ageMs) { fs.unlinkSync(p); removed++; }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  const active = new Set();
  const s = readState();
  if (s) for (const k of ['eventsFile', 'errFile', 'outFile']) if (s[k]) active.add(s[k]);
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!/^codex-bridge-/.test(f)) continue;
      const p = path.join(os.tmpdir(), f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && !active.has(p) && Date.now() - st.mtimeMs > 3600e3) { fs.unlinkSync(p); removed++; }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  console.log(`clean 完成：删除 ${removed} 个过期临时文件（incoming-images/shots 阈值 ${hours || 24} 小时，codex-bridge 文件阈值 1 小时）`);
}

// ---------------- type / key（向指定窗口发按键） ----------------

function escapeSendKeys(text) {
  return String(text).replace(/([{}()[\]+\^%~])/g, (m) => `{${m}}`);
}

/** 原子操作：聚焦窗口 → 延迟 → 发按键。返回 0=成功 1=窗口不存在 其它=错误。 */
function focusAndSend(target, keys, delay) {
  const safeT = String(target).replace(/'/g, "''");
  const safeK = keys.replace(/'/g, "''");
  const isPid = /^\d+$/.test(String(target));
  const appArg = isPid ? `[int]${Number(target)}` : `'${safeT}'`;
  const script = `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate(${appArg})) { exit 1 }; Start-Sleep -Seconds ${delay}; $w.SendKeys('${safeK}'); exit 0`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: delay * 1000 + 15000, windowsHide: true });
  return r.status;
}

// ---------------- main ----------------

function main() {
  const { mode, positionals, opts } = parseArgs(process.argv.slice(2));
  if (!mode) { console.error(HELP); process.exit(1); }

  if (mode === 'status') { showStatus(); return; }
  if (mode === 'events') { showEvents(opts.tail || Number(positionals[0]) || 15); return; }
  if (mode === 'stop') { stopWatch(); return; }
  if (mode === 'clean') { cleanMode(Number(positionals[0]) || 24); return; }
  if (mode === 'shot') { shotMode(positionals.length ? positionals.join(' ') : '', opts); return; }
  if (mode === 'fetch') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    fetchMode(positionals[0], opts);
    return;
  }
  if (mode === 'search') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    searchMode(positionals.join(' '), opts);
    return;
  }
  if (mode === 'type' || mode === 'key') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    if (!opts.window) {
      console.error('[codex-bridge] 必须指定 --window <窗口标题开头或PID>，拒绝盲发按键（会打进任意前台窗口）');
      process.exit(6);
    }
    const payload = mode === 'type' ? escapeSendKeys(positionals.join(' ')) : positionals.join(' ');
    console.log(`[codex-bridge] 聚焦窗口 ${opts.window} → ${opts.delay || 3} 秒后发送${mode === 'type' ? '文本' : '按键'}…`);
    const code = focusAndSend(opts.window, payload, opts.delay || 3);
    if (code === 0) console.log('[codex-bridge] 已发送');
    else if (code === 1) console.error(`[codex-bridge] 无法聚焦窗口 "${opts.window}"，已取消发送`);
    else console.error(`[codex-bridge] 发送失败（exit=${code}）`);
    return;
  }
  if (mode === 'read' && positionals[0] && /^https?:\/\//i.test(positionals[0])) { fetchMode(positionals[0], opts); return; }
  if (mode === 'watch') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    watchTask(positionals.join(' '), opts.rules, opts);
    return;
  }
  if (mode === 'steer') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    steerWatch(positionals.join(' '), opts);
    return;
  }

  if (!['see', 'read', 'ask', 'gen', 'hands'].includes(mode)) { console.error(`unknown mode: ${mode}\n${HELP}`); process.exit(2); }
  if (mode === 'hands' ? positionals.length < 2 : positionals.length < 1) { console.error(HELP); process.exit(1); }
  const { text, exit, signal, errTail } = runCodexSync(buildArgs(mode, positionals, opts), opts);
  if (text) { console.log(text); process.exit(0); }
  console.error(`[codex-bridge] codex 没有产出结果（exit=${exit}, signal=${signal}）`);
  if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
  process.exit(4);
}

main();
