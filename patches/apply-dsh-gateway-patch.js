#!/usr/bin/env node
/*
 * apply-dsh-gateway-patch.js — 给 DeepSeek Harness 的 dsh-host-apiproxy 打「图片落地成文件」补丁
 *
 * 用法: node apply-dsh-gateway-patch.js <path/to/dsh-host-apiproxy/lib/index.js>
 *
 * 作用: 让无视觉模型（如 DeepSeek-V4-Pro）的图片消息不再被网关拒绝，
 *       而是落地成文件、把绝对路径以文本注入 agent 消息（配合 codex-bridge 的 see 模式）。
 *
 * 安全: 自动备份原文件为 <file>.bak-<时间戳>；任一步匹配失败会自动回滚。
 * 生效: 改完需重启 dsh web（该文件是打包 JS，启动时加载进内存）。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const IMPORT_EDITS = [
  ['import { mkdir, stat } from "node:fs/promises";',
   'import { mkdir, stat, writeFile } from "node:fs/promises";'],
  ['import { dirname, extname } from "node:path";',
   'import { dirname, extname, join } from "node:path";'],
  ['import { release } from "node:os";',
   'import { release, tmpdir } from "node:os";']
];

const FUNC_ANCHOR = '/** Search durable content for an image reference, including nested tool results. */';

const FUNC_BLOCK = `/** Extension for an image media type, used when materializing to disk. */
function imageExtension(mediaType) {
\tswitch (mediaType) {
\t\tcase "image/png": return ".png";
\t\tcase "image/jpeg": return ".jpg";
\t\tcase "image/webp": return ".webp";
\t\tcase "image/gif": return ".gif";
\t\tdefault: return "";
\t}
}
/**
 * Materialize image parts to on-disk files and rewrite them as text pointers.
 *
 * A model that cannot accept image input must never receive an image part.
 * Instead each raster is written to a private directory and its prompt part is
 * replaced with a text block carrying the absolute path, so the agent can hand
 * the file to an external vision tool (for example a local Codex CLI) and
 * answer from that tool's transcript.
 */
async function materializeImageContent(content) {
\tconst dir = join(tmpdir(), "dsh-incoming-images");
\tawait mkdir(dir, { recursive: true });
\tconst blocks = [];
\tfor (const part of content) {
\t\tif (part.type === "text") {
\t\t\tblocks.push({ type: "text", text: part.text });
\t\t\tcontinue;
\t\t}
\t\tconst file = join(dir, \`\${randomUUID()}\${imageExtension(part.mediaType)}\`);
\t\tawait writeFile(file, decodeBase64(part.data));
\t\tconst name = part.name === void 0 ? file : part.name;
\t\tblocks.push({
\t\t\ttype: "text",
\t\t\ttext: [
\t\t\t\t"[图片附件] 用户在本条消息附带了一张图片（当前模型无法直接查看图片内容）。",
\t\t\t\t\`原始文件名: \${name}\`,
\t\t\t\t\`本地文件绝对路径: \${file}\`,
\t\t\t\t"请用 codex-bridge 技能调用本机 codex CLI 分析该图片文件，拿到文字结果后再回答用户。"
\t\t\t].join("\\n")
\t\t});
\t}
\treturn blocks;
}
/** Search durable content for an image reference, including nested tool results. */`;

const PROMPT_OLD = [
  '\t\t\t\t\t\tif (hasImage) {',
  '\t\t\t\t\t\t\tconst current = selectionFor(agent).current;',
  '\t\t\t\t\t\t\tconst modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);',
  '\t\t\t\t\t\t\tif (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {',
  '\t\t\t\t\t\t\t\tcode: "attachment-error",',
  '\t\t\t\t\t\t\t\tmessage: `Model "${current.model}" does not support image input.`,',
  '\t\t\t\t\t\t\t\tdetails: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }',
  '\t\t\t\t\t\t\t});',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t\tconst message = createUserMessage({',
  '\t\t\t\t\t\t\tcontent: await durablePromptContent(ctx, content),',
  '\t\t\t\t\t\t\tsource',
  '\t\t\t\t\t\t});'
].join('\n');

const PROMPT_NEW = [
  '\t\t\t\t\t\tlet durable;',
  '\t\t\t\t\t\tif (hasImage) {',
  '\t\t\t\t\t\t\tconst current = selectionFor(agent).current;',
  '\t\t\t\t\t\t\tconst modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);',
  '\t\t\t\t\t\t\tconst supportsImage = modelInfo.inputModalities === void 0 || modelInfo.inputModalities.includes("image");',
  '\t\t\t\t\t\t\tdurable = supportsImage ? await durablePromptContent(ctx, content) : await materializeImageContent(content);',
  '\t\t\t\t\t\t} else {',
  '\t\t\t\t\t\t\tdurable = await durablePromptContent(ctx, content);',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t\tconst message = createUserMessage({',
  '\t\t\t\t\t\t\tcontent: durable,',
  '\t\t\t\t\t\t\tsource',
  '\t\t\t\t\t\t});'
].join('\n');

function fail(msg) {
  console.error('[patch] 失败: ' + msg);
  process.exit(1);
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('用法: node apply-dsh-gateway-patch.js <path/to/dsh-host-apiproxy/lib/index.js>');
    process.exit(2);
  }
  const file = path.resolve(target);
  if (!fs.existsSync(file)) fail('文件不存在: ' + file);
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes('async function materializeImageContent')) {
    console.log('[patch] 已打过补丁（检测到 materializeImageContent），无需重复应用。');
    process.exit(0);
  }
  if (src.includes('let durable;')) {
    console.log('[patch] 检测到部分修改痕迹，请人工检查: ' + file);
    process.exit(3);
  }

  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  console.log('[patch] 已备份原文件: ' + backup);

  try {
    // 1) 三行 import
    for (const [from, to] of IMPORT_EDITS) {
      if (!src.includes(from)) throw new Error('import 行未匹配（版本可能已变化）: ' + from.slice(0, 60));
      src = src.split(from).join(to);
    }
    // 2) 插入函数
    if (src.split(FUNC_ANCHOR).length - 1 !== 1) throw new Error('函数插入锚点未匹配（应恰好出现一次）');
    src = src.replace(FUNC_ANCHOR, FUNC_BLOCK);
    // 3) prompt 处理器分流
    if (src.split(PROMPT_OLD).length - 1 !== 1) throw new Error('prompt 处理器代码块未匹配（版本可能已变化）');
    src = src.replace(PROMPT_OLD, PROMPT_NEW);
  } catch (err) {
    fs.copyFileSync(backup, file);
    console.error('[patch] 已回滚。原因: ' + err.message);
    process.exit(4);
  }

  // 校验
  const ok = src.includes('async function materializeImageContent') && src.includes('supportsImage');
  if (!ok) {
    fs.copyFileSync(backup, file);
    fail('校验失败，已回滚（请检查 dsh 版本是否兼容）');
  }
  fs.writeFileSync(file, src);
  console.log('[patch] 补丁已应用: ' + file);
  console.log('[patch] 下一步：重启 dsh web 使其生效（重启后发图即会落地成文件并注入路径文本）。');
  console.log('[patch] 若要撤销：用备份覆盖回原文件: ' + backup);
}

module.exports = { IMPORT_EDITS, FUNC_ANCHOR, FUNC_BLOCK, PROMPT_OLD, PROMPT_NEW };

if (require.main === module) main();
