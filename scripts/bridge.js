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

const VERSION = '1.2.0';

const VISION_PROMPT = '仔细看这张图：详细描述画面内容，逐字转写所有可见文字（标题、正文、按钮、代码、数字、菜单等）；如果是图表/流程图/UI/文档，说明其结构和数据。不要调用任何工具或执行命令，直接输出分析结果。';
const READ_PROMPT = '请自己想办法查看这个目标（解压压缩包、列目录、读取文本、必要时转换格式或提取二进制里的字符串），用中文总结：1) 里面有什么（文件清单/结构）；2) 重点内容。可以做只读性质的 shell 操作，不要修改原文件、不要做破坏性操作。最后直接输出总结。';

const DEFAULT_RULES = [
  '只在任务指定的范围内操作，不要动范围外的任何文件。',
  '不得删除、覆盖任何与任务无关的已有文件；不得修改系统设置；不得安装软件。（保护性红线，只防破坏，不阻断任务本身）',
  '用户已全权授权：任务要求一次性执行到完成并汇报结果；除上面的保护性红线外，不要中途停下询问确认——包括发送消息、点击按钮、输入内容这类操作，一律直接执行。',
  '命令优先：能用命令行、脚本、键盘快捷键完成的操作，一律先用命令/快捷键；只有确实需要 GUI 鼠标交互时才用 computer_use。',
  '先输出 1-3 行计划再动手；每完成一步，用一句话报告进度。',
  '同一个报错不要用同一种方式重试超过两次；换个思路，或报告卡点。'
].join('\n');

const HELP = `codex-bridge — 调用本机 Codex CLI 当眼睛和手

用法: node bridge.js <模式> [参数...] [选项]

模式:
  see   <图片路径...> [--ask "用户问题"]  看图 / 多图对比
  read  <路径> [--ask "用户问题"]         解读压缩包/文件夹/特殊格式
  ask   "<追问>" [--for see|read|other]     复用会话追问（默认最近会话；--for 指定同类会话）
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
  probe                                 列出中转模型并实测视觉端点（红方块自检）
  locate <图片> --target "<元素>"        定位 UI 元素，返回像素/归一化坐标
  ocr <图片>                             逐块 OCR（带坐标 JSON）
  click <x> <y> [--button right]         点击屏幕坐标（默认 3 秒延迟；动真实鼠标，先经用户确认）
  scroll <格数>                          滚轮滚动（正=上，负=下）
  open <目标>                            打开系统位置/应用/路径（回收站/此电脑/控制面板/任务管理器/记事本/设置/下载…；验货：PID+置前）

选项:
  --effort minimal|low|medium|high|xhigh|max|ultra   思考强度，默认 ultra（最高档）
  --backup auto|only|off     备用通道（Claude）：auto=主通道失败自动切换（默认）/ only=只用备用 / off=关闭
  --direct on|off|only       see/locate/ocr 直连视觉（默认 on：直连失败自动回退 codex exec）
  --crop x,y,w,h             see/locate/ocr 先裁切区域再分析
  --zoom <倍率>              配合 --crop 放大后再分析
  --target "<元素>"          locate 模式的目标元素描述
  --button left|right        click 模式的按键（默认左键）
  --double                   click 模式双击
  --verify                   click 模式：点击前截屏 + 直连识别前台应用（防屏幕状态漂移）
  --backend computer|browser watch 模式：启用 computer_use / browser_use（指挥官模式）
  --bypass                   watch 模式：绕过 computer_use 的批准弹窗（QQ 等应用必需；仍受 codex 红线约束）
  --delay <秒>               type/key 发送按键前的延迟，默认 3
  --window <标题开头或PID>    type/key 的目标窗口（必填；聚焦失败则取消发送）
  --model <模型id>           覆盖默认模型
  --timeout <秒>             超时，默认 300
  --workspace <目录>         指定 codex 工作目录
  --rules "<额外红线>"       追加到 watch 默认红线
  --tail <N>                 events 模式的条数
`;

function parseArgs(argv) {
  const opts = { effort: 'ultra', backup: 'auto', delay: undefined, window: undefined, model: undefined, timeout: 300, workspace: undefined, ask: undefined, outDir: undefined, rules: undefined, tail: undefined, target: undefined, crop: undefined, zoom: undefined, direct: undefined, button: undefined };
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
    else if (a === '--target') opts.target = argv[++i];
    else if (a === '--crop') opts.crop = argv[++i].split(',').map(Number);
    else if (a === '--zoom') opts.zoom = Number(argv[++i]);
    else if (a === '--direct') opts.direct = argv[++i];
    else if (a === '--button') opts.button = argv[++i];
    else if (a === '--double') opts.double = true;
    else if (a === '--verify') opts.verify = true;
    else if (a === '--for') opts.for = argv[++i];
    else if (a === '--backend') opts.backend = argv[++i];
    else if (a === '--bypass') opts.bypass = true;
    else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
    else if (a === '--version' || a === '-V') { console.log(`codex-bridge v${VERSION}`); process.exit(0); }
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
      const tid = readLastThread(opts.for || 'auto');
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
  if (threadId) saveLastThread(threadId, opts.threadCategory);

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
function threadFileFor(cat) {
  return path.join(os.tmpdir(), `codex-bridge-last-thread-${cat || 'other'}.txt`);
}
function saveLastThread(id, cat) {
  try {
    fs.writeFileSync(LAST_THREAD_FILE, String(id), 'utf8');
    if (cat) fs.writeFileSync(threadFileFor(cat), String(id), 'utf8');
  } catch { /* ignore */ }
}
function readLastThread(cat) {
  try {
    const file = cat && cat !== 'auto' ? threadFileFor(cat) : LAST_THREAD_FILE;
    const v = fs.readFileSync(file, 'utf8').trim();
    return v || null;
  } catch { return null; }
}

/** Read the current codex channel (base_url + key) from the CC Switch database. */
function readCodexChannel() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
    if (!fs.existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("SELECT settings_config FROM providers WHERE app_type='codex' ORDER BY is_current DESC").all();
    db.close();
    for (const r of rows) {
      try {
        const c = JSON.parse(r.settings_config);
        const key = c.auth?.OPENAI_API_KEY;
        const cfgText = c.config || '';
        const m = /base_url\s*=\s*"([^"]+)"/.exec(cfgText);
        if (key && m) return { apiKey: key, baseUrl: m[1].replace(/\/+$/, '') };
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return null;
}

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** 直连视觉：把图片发给中转的 /v1/responses 视觉端点，返回文字（不走 codex exec，快）。 */
async function directVision(imagePath, prompt, opts) {
  const ch = readCodexChannel();
  if (!ch) throw new Error('无法从 CC Switch 读取 codex 通道配置');
  const img = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'image/png';
  const body = {
    model: opts.model || 'gpt-5.6-sol',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: `data:${mime};base64,${img.toString('base64')}` }
      ]
    }],
    reasoning: { effort: opts.effort === 'ultra' ? 'high' : opts.effort }
  };
  const res = await fetch(`${ch.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ch.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout * 1000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const texts = [];
  for (const item of json.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'output_text' && c.text) texts.push(c.text);
    }
  }
  const text = texts.join('\n').trim();
  if (!text) throw new Error('视觉端点返回空文本');
  return text;
}

/* CRC32 table for hand-rolled PNG */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 手写一张「红色矩形」测试图（零依赖），用于 probe 自检。 */
function makeTestPng(file) {
  const W = 120, H = 80;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      const red = x >= 25 && x <= 95 && y >= 20 && y <= 60;
      row[1 + x * 3] = red ? 220 : 255;
      row[1 + x * 3 + 1] = red ? 30 : 255;
      row[1 + x * 3 + 2] = red ? 30 : 255;
    }
    rows.push(row);
  }
  const idat = require('node:zlib').deflateSync(Buffer.concat(rows));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([td, data])));
    return Buffer.concat([len, td, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return file;
}

/** 解析 PNG/JPEG/GIF 尺寸；解析不了返回 null。 */
function imageDims(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
        if (marker === 0xd9 || marker === 0xda) break;
        const len = buf.readUInt16BE(i + 2);
        const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
        if (sof && len >= 7) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** 大图降采样：>2MB 且长边 >2560px 的图缩到 2048px。返回处理后的路径。 */
function downscaleIfLarge(imagePath) {
  try {
    const buf = fs.readFileSync(imagePath);
    if (buf.length < 2 * 1024 * 1024) return imagePath;
    const dims = imageDims(buf);
    if (!dims || Math.max(dims.width, dims.height) <= 2560) return imagePath;
    const out = path.join(os.tmpdir(), `codex-bridge-rs-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const scale = 2048 / Math.max(dims.width, dims.height);
    const w = Math.round(dims.width * scale);
    const h = Math.round(dims.height * scale);
    const script = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile('${imagePath.replace(/'/g, "''")}'); $b=New-Object System.Drawing.Bitmap($i,${w},${h}); $b.Save('${out.replace(/'/g, "''")}'); $b.Dispose(); $i.Dispose()`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 60000, windowsHide: true });
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    try { fs.unlinkSync(out); } catch { /* ignore */ }
  } catch { /* ignore */ }
  return imagePath;
}

/** 裁切/放大预处理。crop=[x,y,w,h]，zoom=倍率。返回处理后路径（未变则原路径）。 */
function cropZoomImage(imagePath, crop, zoom) {
  if (!crop && !zoom) return imagePath;
  try {
    const out = path.join(os.tmpdir(), `codex-bridge-cz-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    let script = `Add-Type -AssemblyName System.Drawing; $src=[System.Drawing.Image]::FromFile('${imagePath.replace(/'/g, "''")}'); `;
    if (crop) {
      script += `$r=New-Object System.Drawing.Rectangle(${crop[0]},${crop[1]},${crop[2]},${crop[3]}); $bmp=$src.Clone($r,$src.PixelFormat); `;
    } else {
      script += `$bmp=New-Object System.Drawing.Bitmap($src); `;
    }
    if (zoom) {
      script += `$b=New-Object System.Drawing.Bitmap($bmp,[int](${zoom}*$bmp.Width),[int](${zoom}*$bmp.Height)); $bmp.Dispose(); $bmp=$b; `;
    }
    script += `$bmp.Save('${out.replace(/'/g, "''")}'); $bmp.Dispose(); $src.Dispose()`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 60000, windowsHide: true });
    if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    try { fs.unlinkSync(out); } catch { /* ignore */ }
  } catch { /* ignore */ }
  return imagePath;
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
3. 用户已全权授权：不要中途停下来询问确认，一次性执行到完成（保护性红线除外）。
4. 提速要求：优先用键盘快捷键和最短路径，避免反复整屏截图探索；涉及常用应用（QQ 等）先读技能目录下的 ui-playbook.md 找现成操作路径。
5. 任务完成后，输出一段总结：做了什么、结果在哪、有没有异常。`;
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
  if (opts.backend === 'computer') args.push('--enable', 'computer_use');
  if (opts.backend === 'browser') args.push('--enable', 'browser_use');
  if (opts.bypass) args.push('--dangerously-bypass-approvals-and-sandbox');

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
    backend: opts.backend,
    bypass: !!opts.bypass,
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
  if (s.backend === 'computer') args.push('--enable', 'computer_use');
  if (s.backend === 'browser') args.push('--enable', 'browser_use');
  if (s.bypass) args.push('--dangerously-bypass-approvals-and-sandbox');
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

async function shotMode(question, opts) {
  const dir = path.join(os.tmpdir(), 'dsh-shots');
  fs.mkdirSync(dir, { recursive: true });
  const shotPath = path.join(dir, `shot-${Date.now()}.png`);
  if (!takeScreenshot(shotPath)) { console.error('[codex-bridge] 截图失败'); process.exit(5); }
  const prompt = `${question ? `用户问：${question}\n\n` : ''}${VISION_PROMPT}\n\n这是用户当前屏幕的截图。`;
  const r = await runVision(shotPath, prompt, { ...opts, effort: opts.effort === 'ultra' ? 'low' : opts.effort });
  console.log(r.text);
  console.log(`[截图文件: ${shotPath}]`);
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

/** 解码 Bing 重定向链接（u= 参数是 base64url 编码的真实网址）。 */
function decodeBingUrl(u) {
  try {
    const plain = String(u).replace(/&amp;/g, '&');
    const m = /[?&]u=([^&]+)/.exec(plain);
    if (!m) return plain;
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    if (b64.startsWith('a1')) b64 = b64.slice(2); // Bing 的 u= 值带 a1 前缀（URL 类型标记）
    while (b64.length % 4) b64 += '=';
    const real = Buffer.from(b64, 'base64').toString('utf8');
    return real && real.startsWith('http') ? real : plain;
  } catch { /* ignore */ }
  return String(u).replace(/&amp;/g, '&');
}

function searchMode(query, opts) {
  const q = encodeURIComponent(query);
  const outFile = path.join(os.tmpdir(), `codex-bridge-s-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const script = `$ErrorActionPreference='SilentlyContinue'; $h=@{'User-Agent'='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'}; try { (Invoke-WebRequest -Uri 'https://www.bing.com/search?q=${q}' -UseBasicParsing -TimeoutSec 20 -Headers $h).Content | Out-File '${outFile.replace(/'/g, "''")}' -Encoding utf8 } catch { }; try { if (-not (Test-Path '${outFile.replace(/'/g, "''")}') -or (Get-Item '${outFile.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Length -lt 500) { (Invoke-WebRequest -Uri 'https://html.duckduckgo.com/html/?q=${q}' -UseBasicParsing -TimeoutSec 20 -Headers $h).Content | Out-File '${outFile.replace(/'/g, "''")}' -Encoding utf8 } } catch { }`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 90000, windowsHide: true });
  let html = '';
  try { if (fs.existsSync(outFile)) { html = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''); fs.unlinkSync(outFile); } } catch { /* ignore */ }
  if (!html || html.length < 500) { console.error('[codex-bridge] 搜索无结果（抓取失败或本机网络受限）'); process.exit(4); }

  const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const results = [];
  const bingRe = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>)?[\s\S]*?<\/li>/g;
  let m;
  while ((m = bingRe.exec(html)) && results.length < 8) {
    const title = clean(m[2]);
    if (title) results.push({ title: title.slice(0, 120), url: decodeBingUrl(m[1]), snippet: clean(m[3]).slice(0, 200) });
  }
  if (results.length === 0) {
    const ddRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = ddRe.exec(html)) && results.length < 8) {
      const title = clean(m[2]);
      if (title) results.push({ title: title.slice(0, 120), url: m[1], snippet: clean(m[3]).slice(0, 200) });
    }
  }
  if (results.length === 0) { console.error('[codex-bridge] 搜索无结果（解析不到结果条目）'); process.exit(4); }
  console.log(`[搜索「${query}」结果]`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   ${r.url}`);
    if (r.snippet) console.log(`   ${r.snippet}`);
  });
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

/** 原子操作：聚焦窗口 → 延迟 → 发按键。支持 {LWIN} 组合（SendKeys 不支持的 Win 键走 keybd_event）。返回 0=成功 1=窗口不存在 其它=错误。 */
function focusAndSend(target, keys, delay) {
  const safeT = String(target).replace(/'/g, "''");
  const safeK = keys.replace(/'/g, "''");
  const isPid = /^\d+$/.test(String(target));
  const appArg = isPid ? `[int]${Number(target)}` : `'${safeT}'`;
  let script;
  const winMatch = /\{LWIN\}(.)/i.exec(keys);
  if (winMatch) {
    const vk = winMatch[1].toUpperCase().charCodeAt(0);
    const sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.IntPtr extra);';
    script = `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate(${appArg})) { exit 1 }; Start-Sleep -Seconds ${delay}; $t=Add-Type -MemberDefinition '${sig}' -Name K -Namespace W -PassThru; $t::keybd_event(0x5B,0,0,[IntPtr]::Zero); $t::keybd_event(${vk},0,0,[IntPtr]::Zero); $t::keybd_event(${vk},0,2,[IntPtr]::Zero); $t::keybd_event(0x5B,0,2,[IntPtr]::Zero); exit 0`;
  } else {
    script = `$w = New-Object -ComObject WScript.Shell; if (-not $w.AppActivate(${appArg})) { exit 1 }; Start-Sleep -Seconds ${delay}; $w.SendKeys('${safeK}'); exit 0`;
  }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: delay * 1000 + 15000, windowsHide: true });
  return r.status;
}

// ---------------- 视觉原语（direct / locate / ocr / probe / click / scroll） ----------------

function preprocessImage(p, opts) {
  return cropZoomImage(downscaleIfLarge(localizeImage(p)), opts.crop, opts.zoom);
}

/** 直连视觉上下文（最近看过的图），供 ask --for see 追问复用。 */
const VISION_STATE_FILE = path.join(os.tmpdir(), 'codex-bridge-vision-state.json');
function saveVisionState(img) {
  try { fs.writeFileSync(VISION_STATE_FILE, JSON.stringify({ image: img, at: Date.now() }), 'utf8'); } catch { /* ignore */ }
}
function readVisionState() {
  try {
    const s = JSON.parse(fs.readFileSync(VISION_STATE_FILE, 'utf8'));
    return s && s.image && fs.existsSync(s.image) ? s : null;
  } catch { return null; }
}

async function askVisionFollowup(question, opts) {
  const s = readVisionState();
  if (!s) return null;
  try {
    const prompt = `这是一张用户之前发过的图片（之前已向用户描述过它）。现在用户追问：${question}\n\n请基于图片内容直接回答这个追问。`;
    const text = await directVision(s.image, prompt, opts);
    return '[直连视觉·追问]\n' + text;
  } catch { return null; }
}

/** 单图视觉执行：直连优先（默认），失败回退 codex exec（含 Claude 备用）。 */
async function runVision(img, prompt, opts) {
  const wantDirect = opts.direct === 'only' || (opts.direct !== 'off' && true);
  if (wantDirect) {
    try {
      const text = await directVision(img, prompt, opts);
      saveVisionState(img);
      return { text: '[直连视觉]\n' + text, via: 'direct' };
    } catch (err) {
      if (opts.direct === 'only') throw new Error(`直连视觉失败: ${err.message}`);
      console.error(`[codex-bridge] 直连视觉失败（${err.message}），回退 codex exec`);
    }
  }
  const effort = ['-c', `model_reasoning_effort="${opts.effort}"`];
  const r = runCodexSync(['exec', prompt, '-i', img, '-s', 'read-only', '--skip-git-repo-check', '--color', 'never', ...effort], { ...opts, threadCategory: 'see' });
  if (!r.text) throw new Error(`codex 无结果（exit=${r.exit}）${r.errTail ? '\n' + r.errTail.slice(0, 300) : ''}`);
  return { text: r.text, via: r.via };
}

async function seeMode(positionals, opts) {
  const imgs = positionals.map((p) => preprocessImage(p, opts));
  if (imgs.length === 1) {
    const prompt = buildPrompt('see', imgs, opts);
    const r = await runVision(imgs[0], prompt, opts);
    console.log(r.text);
    return;
  }
  const { text, exit, signal, errTail } = runCodexSync(buildArgs('see', imgs, { ...opts, threadCategory: 'see' }), { ...opts, threadCategory: 'see' });
  if (text) { console.log(text); return; }
  console.error(`[codex-bridge] codex 没有产出结果（exit=${exit}, signal=${signal}）`);
  if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
  process.exit(4);
}

async function locateMode(positionals, opts) {
  if (!opts.target) { console.error('locate 需要 --target "<目标元素描述>"'); process.exit(1); }
  const img = preprocessImage(positionals[0], opts);
  const prompt = `找出图中「${opts.target}」的位置。只输出一个 JSON 对象（不要任何多余文字）：{"found":true,"x":<中心像素x>,"y":<中心像素y>,"w":<宽>,"h":<高>,"norm":[<归一化0-1000中心x>,<归一化0-1000中心y>]}。找不到就输出 {"found":false}。`;
  const r = await runVision(img, prompt, opts);
  console.log(r.text);
}

async function ocrMode(positionals, opts) {
  const img = preprocessImage(positionals[0], opts);
  const prompt = `对这张图做逐块 OCR：按从上到下、从左到右输出每个文本块。只输出 JSON 数组（不要多余文字）：[{"text":"...","x":..,"y":..,"w":..,"h":..}]（像素坐标）。图中没有文字就输出 []。`;
  const r = await runVision(img, prompt, opts);
  console.log(r.text);
}

async function probeMode(opts) {
  const ch = readCodexChannel();
  if (!ch) { console.log('未找到 codex 通道（需要 CC Switch，或手动配置）'); return; }
  console.log(`通道地址: ${ch.baseUrl}`);
  try {
    const res = await fetch(`${ch.baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${ch.apiKey}` }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const json = await res.json();
      const ids = (json.data || []).map((m) => m.id || m.name).filter(Boolean);
      console.log(`可用模型（${ids.length}）: ${ids.slice(0, 30).join(', ')}`);
    } else {
      console.log(`模型列表请求失败: HTTP ${res.status}`);
    }
  } catch (err) {
    console.log('模型列表请求失败: ' + err.message);
  }
  const testImg = path.join(os.tmpdir(), `codex-bridge-probe-${Date.now()}.png`);
  makeTestPng(testImg);
  try {
    const text = await directVision(testImg, '这张测试图里有什么颜色和形状？一句话回答。', opts);
    console.log('视觉自检: ' + text.slice(0, 200));
  } catch (err) {
    console.log('视觉自检失败: ' + err.message);
  }
  try { fs.unlinkSync(testImg); } catch { /* ignore */ }
}

function mouseAction(kind, args, opts) {
  const delay = opts.delay == null ? 3 : opts.delay;
  const cs = `using System; using System.Runtime.InteropServices; [StructLayout(LayoutKind.Sequential)] public struct MINPUT { public uint type; public MOUSEINPUT mi; } [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; } public class MI { [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, MINPUT[] inputs, int size); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }`;
  const addType = `Add-Type -TypeDefinition '${cs}'`;
  const makeInput = (x, y, flags, data) => `$i=New-Object MINPUT; $i.type=0; $i.mi.dx=[int]((${x}*65535)/$sw); $i.mi.dy=[int]((${y}*65535)/$sh); $i.mi.mouseData=${data}; $i.mi.dwFlags=0x8000 -bor ${flags}; $i.mi.time=0; $i.mi.dwExtraInfo=[IntPtr]::Zero; [MI]::SendInput(1,@($i),[System.Runtime.InteropServices.Marshal]::SizeOf([Type][MINPUT])) | Out-Null; `;
  let script;
  if (kind === 'click') {
    const [x, y] = args;
    const btn = opts.button === 'right' ? 'right' : 'left';
    const down = btn === 'right' ? 0x0008 : 0x0002;
    const up = btn === 'right' ? 0x0010 : 0x0004;
    const dbl = opts.double
      ? `Start-Sleep -Milliseconds 60; ${makeInput(x, y, down, 0)} Start-Sleep -Milliseconds 60; ${makeInput(x, y, up, 0)} `
      : '';
    script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ${addType}; [MI]::SetProcessDPIAware() | Out-Null; $sw=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width; $sh=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height; Start-Sleep -Seconds ${delay}; ${makeInput(x, y, down, 0)} Start-Sleep -Milliseconds 80; ${makeInput(x, y, up, 0)} ${dbl}`;
  } else {
    const ticks = args[0];
    script = `${addType}; [MI]::SetProcessDPIAware() | Out-Null; Start-Sleep -Seconds ${delay}; $i=New-Object MINPUT; $i.type=0; $i.mi.dx=0; $i.mi.dy=0; $i.mi.mouseData=[uint32](${ticks}*120); $i.mi.dwFlags=0x0800; $i.mi.time=0; $i.mi.dwExtraInfo=[IntPtr]::Zero; [MI]::SendInput(1,@($i),[System.Runtime.InteropServices.Marshal]::SizeOf([Type][MINPUT])) | Out-Null`;
  }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: delay * 1000 + 20000, windowsHide: true });
  return r.status === 0;
}

// ---------------- open（系统位置/应用/路径，shell 优先 + 验货闭环） ----------------

const SHELL_TARGETS = {
  '回收站': { kind: 'shell', shell: 'shell:RecycleBinFolder', titles: ['回收站', 'Recycle Bin'] },
  'recyclebin': { kind: 'shell', shell: 'shell:RecycleBinFolder', titles: ['回收站', 'Recycle Bin'] },
  'recycle': { kind: 'shell', shell: 'shell:RecycleBinFolder', titles: ['回收站', 'Recycle Bin'] },
  '此电脑': { kind: 'shell', shell: 'shell:MyComputerFolder', titles: ['此电脑', 'This PC'] },
  '我的电脑': { kind: 'shell', shell: 'shell:MyComputerFolder', titles: ['此电脑', 'This PC'] },
  'thispc': { kind: 'shell', shell: 'shell:MyComputerFolder', titles: ['此电脑', 'This PC'] },
  '下载': { kind: 'shell', shell: 'shell:Downloads', titles: ['下载', 'Downloads'] },
  'downloads': { kind: 'shell', shell: 'shell:Downloads', titles: ['下载', 'Downloads'] },
  '桌面': { kind: 'shell', shell: 'shell:Desktop', titles: ['桌面', 'Desktop'] },
  'desktop': { kind: 'shell', shell: 'shell:Desktop', titles: ['桌面', 'Desktop'] },
  '文档': { kind: 'shell', shell: 'shell:Personal', titles: ['文档', 'Documents'] },
  'documents': { kind: 'shell', shell: 'shell:Personal', titles: ['文档', 'Documents'] },
  '图片': { kind: 'shell', shell: 'shell:My Pictures', titles: ['图片', 'Pictures'] },
  'pictures': { kind: 'shell', shell: 'shell:My Pictures', titles: ['图片', 'Pictures'] },
  '控制面板': { kind: 'app', app: 'control.exe', titles: ['控制面板', 'Control Panel'] },
  'controlpanel': { kind: 'app', app: 'control.exe', titles: ['控制面板', 'Control Panel'] },
  '任务管理器': { kind: 'app', app: 'taskmgr.exe', titles: ['任务管理器', 'Task Manager'] },
  'taskmgr': { kind: 'app', app: 'taskmgr.exe', titles: ['任务管理器', 'Task Manager'] },
  '记事本': { kind: 'app', app: 'notepad.exe', titles: ['记事本', 'Notepad'] },
  'notepad': { kind: 'app', app: 'notepad.exe', titles: ['记事本', 'Notepad'] },
  '计算器': { kind: 'app', app: 'calc.exe', titles: ['计算器', 'Calculator'] },
  'calculator': { kind: 'app', app: 'calc.exe', titles: ['计算器', 'Calculator'] },
  '设置': { kind: 'app', app: 'ms-settings:', titles: ['设置', 'Settings'] },
  'settings': { kind: 'app', app: 'ms-settings:', titles: ['设置', 'Settings'] },
  '资源管理器': { kind: 'app', app: 'explorer.exe', titles: ['文件资源管理器', 'File Explorer'] },
  '文件资源管理器': { kind: 'app', app: 'explorer.exe', titles: ['文件资源管理器', 'File Explorer'] },
  'explorer': { kind: 'app', app: 'explorer.exe', titles: ['文件资源管理器', 'File Explorer'] }
};

function openMode(target, opts) {
  const key = String(target).toLowerCase();
  const known = SHELL_TARGETS[target] || SHELL_TARGETS[key];
  const outFile = path.join(os.tmpdir(), `codex-bridge-open-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let script = `$ErrorActionPreference='SilentlyContinue'; $out='${outFile.replace(/'/g, "''")}'; `;
  if (known) {
    const titlePat = (known.titles || [known.title || '']).map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const isShell = known.kind === 'shell';
    if (isShell) {
      script += `$before=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle} | Select-Object -ExpandProperty Id); Start-Process explorer.exe -ArgumentList '${known.shell}'; `;
    } else {
      script += `Start-Process '${known.app}'; `;
    }
    script += `Start-Sleep -Seconds 3; `;
    if (isShell) {
      script += `$after=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle}); $newWin=$after | Where-Object {$_.Id -notin $before} | Select-Object -First 1; `;
    }
    script += `if (-not $newWin) { $newWin=Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -match '${titlePat}'} | Sort-Object StartTime -Descending | Select-Object -First 1 }; `;
    script += `if (-not $newWin) { Start-Sleep -Seconds 5; `;
    if (isShell) {
      script += `$after=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle}); $newWin=$after | Where-Object {$_.Id -notin $before} | Select-Object -First 1; `;
    }
    script += `if (-not $newWin) { $newWin=Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -match '${titlePat}'} | Sort-Object StartTime -Descending | Select-Object -First 1 } }; `;
    script += `if ($newWin) { $w=New-Object -ComObject WScript.Shell; $focus=$w.AppActivate($newWin.Id); [pscustomobject]@{opened=$true;pid=$newWin.Id;title=$newWin.MainWindowTitle;focus=$focus} | ConvertTo-Json -Compress | Out-File $out -Encoding utf8 } else { [pscustomobject]@{opened=$true;pid=$null;title='';focus=$false;note='已启动，但 8 秒内未捕获窗口（可能延迟或后台运行）'} | ConvertTo-Json -Compress | Out-File $out -Encoding utf8 }`;
  } else {
    script += `$p=Start-Process '${String(target).replace(/'/g, "''")}' -PassThru -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; if ($p) { [pscustomobject]@{opened=($null -ne (Get-Process -Id $p.Id -ErrorAction SilentlyContinue));pid=$p.Id;title='';focus=$false} | ConvertTo-Json -Compress | Out-File $out -Encoding utf8 } else { [pscustomobject]@{opened=$false;pid=$null;title='';focus=$false;note='启动失败（检查路径/名称是否正确）'} | ConvertTo-Json -Compress | Out-File $out -Encoding utf8 }`;
  }
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 45000, windowsHide: true });
  let r = null;
  try { if (fs.existsSync(outFile)) { r = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '')); fs.unlinkSync(outFile); } } catch { /* ignore */ }
  if (!r) { console.error('[codex-bridge] open 执行失败'); process.exit(4); }
  const name = known ? target : String(target);
  if (r.opened) {
    const focusText = r.focus ? '已置前' : '置前未成功（你在前台使用电脑，Windows 拦住后台抢焦点；点任务栏图标即可看到）';
    console.log(`✅ 已打开「${name}」${r.pid ? `（PID ${r.pid} · ${r.title}）` : ''}；${focusText}`);
    if (r.note) console.log('ℹ ' + r.note);
  } else {
    console.error(`❌ 打开「${name}」失败：${r.note || '未知原因'}`);
    process.exit(5);
  }
}

// ---------------- main ----------------

async function main() {
  const { mode, positionals, opts } = parseArgs(process.argv.slice(2));
  if (!mode) { console.error(HELP); process.exit(1); }

  if (mode === 'status') { showStatus(); return; }
  if (mode === 'events') { showEvents(opts.tail || Number(positionals[0]) || 15); return; }
  if (mode === 'stop') { stopWatch(); return; }
  if (mode === 'clean') { cleanMode(Number(positionals[0]) || 24); return; }
  if (mode === 'shot') { await shotMode(positionals.length ? positionals.join(' ') : '', opts); return; }
  if (mode === 'probe') { await probeMode(opts); return; }
  if (mode === 'open') {
    if (positionals.length < 1) { console.error('用法: bridge.js open <回收站|此电脑|控制面板|下载|路径|网址>'); process.exit(1); }
    openMode(positionals.join(' '), opts);
    return;
  }
  if (mode === 'locate') {
    if (positionals.length < 1 || !opts.target) { console.error('用法: bridge.js locate <图片> --target "<元素>"'); process.exit(1); }
    await locateMode(positionals, opts);
    return;
  }
  if (mode === 'ocr') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    await ocrMode(positionals, opts);
    return;
  }
  if (mode === 'click') {
    if (positionals.length < 2) { console.error('用法: bridge.js click <x> <y> [--button right] [--double] [--verify]'); process.exit(1); }
    const [x, y] = [Number(positionals[0]), Number(positionals[1])];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { console.error('坐标无效'); process.exit(1); }
    if (opts.verify) {
      const dir = path.join(os.tmpdir(), 'dsh-shots');
      fs.mkdirSync(dir, { recursive: true });
      const shotPath = path.join(dir, `click-verify-${Date.now()}.png`);
      if (takeScreenshot(shotPath)) {
        try {
          const desc = await directVision(shotPath, '一句话回答：当前屏幕的前台是什么应用？屏幕上主要有什么？', { ...opts, effort: 'low', timeout: 60 });
          console.log(`[verify] 当前屏幕: ${desc.slice(0, 200)}`);
          console.log(`[verify] 截图存档: ${shotPath}`);
        } catch (err) {
          console.log(`[verify] 视觉检查失败（${err.message}），继续执行点击`);
        }
      } else {
        console.log('[verify] 截图失败，继续执行点击');
      }
    }
    console.log(`[codex-bridge] ${opts.delay == null ? 3 : opts.delay} 秒后${opts.double ? '双击' : '点击'}屏幕 (${x},${y})${opts.button === 'right' ? '（右键）' : ''}…`);
    console.log(mouseAction('click', [x, y], opts) ? '[codex-bridge] 已点击' : '[codex-bridge] 点击失败');
    return;
  }
  if (mode === 'scroll') {
    const ticks = Number(positionals[0]);
    if (!Number.isFinite(ticks)) { console.error('用法: bridge.js scroll <格数>（正=上，负=下）'); process.exit(1); }
    console.log(`[codex-bridge] ${opts.delay == null ? 3 : opts.delay} 秒后滚动 ${ticks} 格…`);
    console.log(mouseAction('scroll', [ticks], opts) ? '[codex-bridge] 已滚动' : '[codex-bridge] 滚动失败');
    return;
  }
  if (mode === 'ask') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    const q = positionals.join(' ');
    if (opts.for === 'see') {
      const ans = await askVisionFollowup(q, opts);
      if (ans) { console.log(ans); return; }
      console.error('[codex-bridge] 没有直连视觉上下文，回退 codex 会话续跑');
    }
    const { text, exit, signal, errTail } = runCodexSync(buildArgs('ask', positionals, { ...opts, threadCategory: 'ask' }), { ...opts, threadCategory: 'ask' });
    if (text) { console.log(text); process.exit(0); }
    console.error(`[codex-bridge] codex 没有产出结果（exit=${exit}, signal=${signal}）`);
    if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
    process.exit(4);
  }
  if (mode === 'see') { await seeMode(positionals, opts); return; }
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
    console.log(`[codex-bridge] 聚焦窗口 ${opts.window} → ${opts.delay == null ? 3 : opts.delay} 秒后发送${mode === 'type' ? '文本' : '按键'}…`);
    const code = focusAndSend(opts.window, payload, opts.delay == null ? 3 : opts.delay);
    if (code === 0) console.log('[codex-bridge] 已发送');
    else if (code === 1) console.error(`[codex-bridge] 无法聚焦窗口 "${opts.window}"，已取消发送`);
    else console.error(`[codex-bridge] 发送失败（exit=${code}）`);
    return;
  }
  if (mode === 'read' && positionals[0] && /^https?:\/\//i.test(positionals[0])) { fetchMode(positionals[0], opts); return; }
  if (mode === 'watch') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    if (opts.backend && opts.effort === 'ultra') opts.effort = 'low'; // GUI 机械操作要速度，默认降档
    watchTask(positionals.join(' '), opts.rules, opts);
    return;
  }
  if (mode === 'steer') {
    if (positionals.length < 1) { console.error(HELP); process.exit(1); }
    steerWatch(positionals.join(' '), opts);
    return;
  }

  if (!['read', 'gen', 'hands'].includes(mode)) { console.error(`unknown mode: ${mode}\n${HELP}`); process.exit(2); }
  if (mode === 'hands' ? positionals.length < 2 : positionals.length < 1) { console.error(HELP); process.exit(1); }
  const { text, exit, signal, errTail } = runCodexSync(buildArgs(mode, positionals, { ...opts, threadCategory: mode }), { ...opts, threadCategory: mode });
  if (text) { console.log(text); process.exit(0); }
  console.error(`[codex-bridge] codex 没有产出结果（exit=${exit}, signal=${signal}）`);
  if (errTail) console.error(`[codex-bridge] stderr 末尾:\n${errTail}`);
  process.exit(4);
}

main().catch((e) => {
  console.error('[codex-bridge] 未处理错误: ' + (e && e.message ? e.message : e));
  process.exit(7);
});
