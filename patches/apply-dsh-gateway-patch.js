#!/usr/bin/env node
/*
 * apply-dsh-gateway-patch.js — 给 DeepSeek Harness 打「附件落地成文件」补丁（v1.2.1）
 *
 * 用法:
 *   node apply-dsh-gateway-patch.js <dsh-host-apiproxy/lib/index.js> [<dsh-llm-deepseek/lib/index.js>] [<dsh-client-ui-conversation/lib/client.js>]
 *
 * 作用:
 *   1) 网关：无视觉模型发图片不再被拒，图片落地 %TEMP%\dsh-incoming-images\，路径以文本注入 agent 消息；
 *   2) 网关：非图片文件（zip/exe/pdf/…）也能上传，落地 %TEMP%\dsh-incoming-files\（保留原始文件名、扩展名映射）；
 *   3) 适配器（可选，第 2 参数）：图片块降级为占位符，对话记录显示图片缩略图；
 *   4) 客户端（可选，第 3 参数）：放开附件 MIME 白名单（默认只允许 4 种图片），
 *      非图片附件显示文件图标缩略图、不弹图片灯箱、100MB 上限。
 *
 * 安全: 自动备份原文件为 <file>.bak-<时间戳>；任一步匹配失败自动回滚。幂等：重复执行自动跳过已打部分。
 * 生效: 服务端两个文件改完需重启 dsh web；客户端文件改完刷新页面即可（/plugins 路由 no-cache 现读）。
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

// prompt 内容 schema：mediaType 从「4 种图片」放宽为任意字符串（非图片文件也放行）
const SCHEMA_OLD = '}), z$1.object({\n\ttype: z$1.literal("image"),\n\tmediaType: imageMediaTypeSchema,\n\tdata: z$1.string(),\n\tname: z$1.string().optional()\n})]);';
const SCHEMA_NEW = '}), z$1.object({\n\ttype: z$1.literal("image"),\n\tmediaType: z$1.string(),\n\tdata: z$1.string(),\n\tname: z$1.string().optional()\n})]);';

const FUNC_ANCHOR = '/** Search durable content for an image reference, including nested tool results. */';

// 新函数块（v1.2.1）：图片照旧 + 非图片文件落盘为真实文件
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
/** Extension for a non-image attachment: original file name's extension wins, media type falls back. */
function fileExtension(mediaType, name) {
\tconst m = /(?:^|[\\\\/])([^\\\\/]*?)(\\.[A-Za-z0-9]{1,8})?$/.exec(String(name ?? ""));
\tif (m !== null && m[2] !== void 0) return m[2].toLowerCase();
\tswitch (mediaType) {
\t\tcase "application/zip": return ".zip";
\t\tcase "application/x-7z-compressed": return ".7z";
\t\tcase "application/x-rar-compressed": case "application/vnd.rar": return ".rar";
\t\tcase "application/gzip": return ".gz";
\t\tcase "application/x-tar": return ".tar";
\t\tcase "application/pdf": return ".pdf";
\t\tcase "text/plain": return ".txt";
\t\tcase "text/markdown": return ".md";
\t\tcase "application/json": return ".json";
\t\tcase "application/xml": case "text/xml": return ".xml";
\t\tcase "text/csv": return ".csv";
\t\tcase "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
\t\tcase "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return ".xlsx";
\t\tcase "application/vnd.openxmlformats-officedocument.presentationml.presentation": return ".pptx";
\t\tcase "application/vnd.android.package-archive": return ".apk";
\t\tcase "application/x-msdownload": case "application/octet-stream": return ".bin";
\t\tdefault: return "";
\t}
}
/** Turn a user-supplied file name into a safe on-disk basename, keeping its extension. */
function sanitizeFileName(name, fallbackExt) {
\tlet base = String(name ?? "").replace(/[\\\\/:*?"<>|\\x00-\\x1f]/g, "_").replace(/^\\.+/, "").trim();
\tif (base === "") base = "file";
\tif (!/\\.[A-Za-z0-9]{1,8}$/.test(base) && fallbackExt !== "") base += fallbackExt;
\treturn base;
}
/**
 * Materialize attachment parts to on-disk files and rewrite them as text pointers.
 *
 * A model that cannot accept image input must never receive an image part, and
 * it cannot read arbitrary binaries either. Images land in a private directory
 * with a UI thumbnail preserved; any other attachment is written as a real file
 * (original name kept, sanitized) and handed to the agent as a path.
 */
async function materializeImageContent(ctx, content) {
\tconst dir = join(tmpdir(), "dsh-incoming-images");
\tconst filesDir = join(tmpdir(), "dsh-incoming-files");
\tawait mkdir(dir, { recursive: true });
\tawait mkdir(filesDir, { recursive: true });
\tconst blocks = [];
\tfor (const part of content) {
\t\tif (part.type === "text") {
\t\t\tblocks.push({ type: "text", text: part.text });
\t\t\tcontinue;
\t\t}
\t\tconst isImage = typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
\t\tconst data = decodeBase64(part.data);
\t\tif (!isImage) {
\t\t\t// 非图片附件：落盘为真实文件（保留原始文件名），只把路径交给模型
\t\t\tconst fallbackExt = fileExtension(part.mediaType, part.name);
\t\t\tconst file = join(filesDir, \`\${randomUUID()}-\${sanitizeFileName(part.name, fallbackExt)}\`);
\t\t\tawait writeFile(file, data);
\t\t\tblocks.push({
\t\t\t\ttype: "text",
\t\t\t\ttext: [
\t\t\t\t\t\`[文件附件] 用户在本条消息附带了一个文件（\${part.mediaType || "未知类型"}，当前模型无法直接读取二进制内容）。\`,
\t\t\t\t\t\`原始文件名: \${part.name === void 0 ? file : part.name}\`,
\t\t\t\t\t\`本地文件绝对路径: \${file}\`,
\t\t\t\t\t"请用本地工具（pwsh / codex-bridge 的 read、see 模式）读取、解压或分析该文件，拿到文字结果后再回答用户。"
\t\t\t\t].join("\\n")
\t\t\t});
\t\t\tcontinue;
\t\t}
\t\tconst file = join(dir, \`\${randomUUID()}\${imageExtension(part.mediaType)}\`);
\t\tawait writeFile(file, data);
\t\tconst name = part.name === void 0 ? file : part.name;
\t\tlet attachment;
\t\ttry {
\t\t\tattachment = await ctx.attachments.saveImage({
\t\t\t\tdata,
\t\t\t\tmediaType: part.mediaType,
\t\t\t\t...part.name === void 0 ? {} : { name: part.name }
\t\t\t});
\t\t} catch { /* UI 展示失败不影响主流程 */ }
\t\tif (attachment !== void 0) blocks.push({ type: "image", attachment });
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

// v1.2.0 旧版函数块（用于给已打旧补丁的安装做原地升级）
const OLD_FUNC_BLOCK = `/** Extension for an image media type, used when materializing to disk. */
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
async function materializeImageContent(ctx, content) {
\tconst dir = join(tmpdir(), "dsh-incoming-images");
\tawait mkdir(dir, { recursive: true });
\tconst blocks = [];
\tfor (const part of content) {
\t\tif (part.type === "text") {
\t\t\tblocks.push({ type: "text", text: part.text });
\t\t\tcontinue;
\t\t}
\t\tconst file = join(dir, \`\${randomUUID()}\${imageExtension(part.mediaType)}\`);
\t\tconst data = decodeBase64(part.data);
\t\tawait writeFile(file, data);
\t\tconst name = part.name === void 0 ? file : part.name;
\t\tlet attachment;
\t\ttry {
\t\t\tattachment = await ctx.attachments.saveImage({
\t\t\t\tdata,
\t\t\t\tmediaType: part.mediaType,
\t\t\t\t...part.name === void 0 ? {} : { name: part.name }
\t\t\t});
\t\t} catch { /* UI 展示失败不影响主流程 */ }
\t\tif (attachment !== void 0) blocks.push({ type: "image", attachment });
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
  '\t\t\t\t\t\t\tdurable = supportsImage ? await durablePromptContent(ctx, content) : await materializeImageContent(ctx, content);',
  '\t\t\t\t\t\t} else {',
  '\t\t\t\t\t\t\tdurable = await durablePromptContent(ctx, content);',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t\tconst message = createUserMessage({',
  '\t\t\t\t\t\t\tcontent: durable,',
  '\t\t\t\t\t\t\tsource',
  '\t\t\t\t\t\t});'
].join('\n');

// —— 适配器补丁（dsh-llm-deepseek）：图片块降级为占位符而不是报错，
//    这样消息里保留图片块（UI 显示缩略图），发给模型时替换成文本。
const ADAPTER_EDITS = [
  ['/** Join the text blocks of a message (used for user/tool-result content). */\nfunction flattenText(blocks) {\n\treturn blocks.filter((block) => block.type === "text").map((block) => block.text).join("");\n}',
   '/** Join the text blocks of a message; image blocks degrade to a placeholder so the model never sees raw image content. */\nfunction flattenText(blocks) {\n\treturn blocks.map((block) => block.type === "text" ? block.text : block.type === "image" ? "(image omitted: model does not support images)" : "").join("");\n}'],
  ['\t\tassertTextOnly(message.content);\n', '']
];

// —— 客户端补丁（dsh-client-ui-conversation）：放开附件 MIME 白名单
const CLIENT_EDITS = [
  // 1) 非图片附件用 SVG 文件图标缩略图（图片仍用对象 URL）
  ['\t\t/** Create one browser-only draft descriptor; only its id enters input state. */\n\t\tfunction browserDraftAttachment(file) {\n\t\t\treturn {\n\t\t\t\tkind: "image",\n\t\t\t\tid: crypto.randomUUID(),\n\t\t\t\tpreviewUrl: URL.createObjectURL(file),\n\t\t\t\tfile\n\t\t\t};\n\t\t}',
   '\t\t/** Create one browser-only draft descriptor; only its id enters input state. */\n\t\t/** SVG data-URL thumbnail for non-image draft files (the image rail renders it in place of a raster). */\n\t\tfunction fileIconDataUrl(name) {\n\t\t\tconst label = (name || "file").replace(/[<>&"\']/g, "").slice(0, 12) || "file";\n\t\t\tconst svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect x="8" y="2" width="56" height="68" rx="8" fill="#4f7cf7"/><rect x="8" y="2" width="56" height="18" rx="8" fill="#7fa3ff"/><text x="36" y="15" font-size="10" text-anchor="middle" fill="#ffffff" font-family="sans-serif">\${label}</text><text x="36" y="48" font-size="9" text-anchor="middle" fill="#dbe7ff" font-family="sans-serif">FILE</text></svg>`;\n\t\t\treturn `data:image/svg+xml;charset=utf-8,\${encodeURIComponent(svg)}`;\n\t\t}\n\t\tfunction browserDraftAttachment(file) {\n\t\t\tconst isImage = typeof file.type === "string" && file.type.startsWith("image/");\n\t\t\treturn {\n\t\t\t\tkind: "image",\n\t\t\t\tid: crypto.randomUUID(),\n\t\t\t\tpreviewUrl: isImage ? URL.createObjectURL(file) : fileIconDataUrl(file.name),\n\t\t\t\tfile\n\t\t\t};\n\t\t}'],
  // 2) MIME 白名单：非图片放行（空 MIME 按二进制）
  ['\t\t\t\tdefault: throw new UnsupportedImageMediaTypeError(value);',
   '\t\t\t\tdefault:\n\t\t\t\t\tif (typeof value === "string") return value.length > 0 ? value : "application/octet-stream"; // 非图片文件放行：原样透传 MIME（空则按二进制），由后端落盘转文字路径\n\t\t\t\t\tthrow new UnsupportedImageMediaTypeError(value);'],
  // 3) 非图片文件 100MB 上限
  ['\t\t\t\t\tif (imageLimits !== void 0) {\n\t\t\t\t\t\tif (files.some((file) => !imageLimits.mediaTypes.includes(file.type))) return addImages(files);',
   '\t\t\t\t\tif (imageLimits !== void 0) {\n\t\t\t\t\t\tif (files.some((file) => !file.type.startsWith("image/") && file.size > 100 * 1024 * 1024)) return t("image.fileTooLarge", { size: "100MB" });\n\t\t\t\t\t\tif (files.some((file) => !imageLimits.mediaTypes.includes(file.type))) return addImages(files);'],
  // 4) 非图片附件不弹图片灯箱
  ['\t\t\t\t\t\t\t\t\t\tsetPreview(item.attachment);',
   '\t\t\t\t\t\t\t\t\t\tif (typeof item.attachment.file.type === "string" && item.attachment.file.type.startsWith("image/")) setPreview(item.attachment);']
];

function fail(msg) {
  console.error('[patch] 失败: ' + msg);
  process.exit(1);
}

function applyEdits(file, edits, label) {
  let src = fs.readFileSync(file, 'utf8');
  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  console.log(`[patch] 已备份: ${backup}`);
  try {
    for (const [from, to] of edits) {
      if (src.split(from).length - 1 !== 1) throw new Error(`${label} 片段未匹配（版本可能已变化）: ${from.slice(0, 60)}`);
      src = src.replace(from, to);
    }
  } catch (err) {
    fs.copyFileSync(backup, file);
    console.error('[patch] 已回滚。原因: ' + err.message);
    process.exit(4);
  }
  fs.writeFileSync(file, src);
  console.log(`[patch] ${label} 补丁已应用: ${file}`);
}

function main() {
  const target = process.argv[2];
  const adapter = process.argv[3] || undefined;
  const client = process.argv[4] || undefined;
  if (!target) {
    console.error('用法: node apply-dsh-gateway-patch.js <dsh-host-apiproxy/lib/index.js> [<dsh-llm-deepseek/lib/index.js>] [<dsh-client-ui-conversation/lib/client.js>]');
    console.error('  第 2 参数可选：给 DeepSeek 适配器打「图片降级占位符」补丁，让对话记录显示图片缩略图');
    console.error('  第 3 参数可选：给 Web 客户端打「附件类型放开」补丁，支持上传任意文件（zip/exe/pdf/…）');
    process.exit(2);
  }
  const file = path.resolve(target);
  if (!fs.existsSync(file)) fail('文件不存在: ' + file);
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes('dsh-incoming-files')) {
    console.log('[patch] 网关已打过 v1.2.1 补丁（检测到 dsh-incoming-files），跳过。');
  } else if (src.includes('async function materializeImageContent')) {
    console.log('[patch] 检测到 v1.2.0 旧补丁，升级到 v1.2.1（文件附件支持）…');
    applyEdits(file, [[OLD_FUNC_BLOCK, FUNC_BLOCK], [SCHEMA_OLD, SCHEMA_NEW]], '网关升级');
  } else {
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
      // 2) 插入函数块（含非图片文件支持）
      if (src.split(FUNC_ANCHOR).length - 1 !== 1) throw new Error('函数插入锚点未匹配（应恰好出现一次）');
      src = src.replace(FUNC_ANCHOR, FUNC_BLOCK);
      // 3) prompt 处理器分流
      if (src.split(PROMPT_OLD).length - 1 !== 1) throw new Error('prompt 处理器代码块未匹配（版本可能已变化）');
      src = src.replace(PROMPT_OLD, PROMPT_NEW);
      // 4) prompt schema 放宽 mediaType
      if (src.split(SCHEMA_OLD).length - 1 !== 1) throw new Error('prompt schema 未匹配（版本可能已变化）');
      src = src.replace(SCHEMA_OLD, SCHEMA_NEW);
    } catch (err) {
      fs.copyFileSync(backup, file);
      console.error('[patch] 已回滚。原因: ' + err.message);
      process.exit(4);
    }

    // 校验
    const ok = src.includes('async function materializeImageContent') && src.includes('supportsImage') && src.includes('dsh-incoming-files');
    if (!ok) {
      fs.copyFileSync(backup, file);
      fail('校验失败，已回滚（请检查 dsh 版本是否兼容）');
    }
    fs.writeFileSync(file, src);
    console.log('[patch] 网关补丁已应用: ' + file);
  }

  if (adapter) {
    const adapterFile = path.resolve(adapter);
    if (!fs.existsSync(adapterFile)) fail('适配器文件不存在: ' + adapterFile);
    const adapterSrc = fs.readFileSync(adapterFile, 'utf8');
    if (adapterSrc.includes('image omitted: model does not support images')) {
      console.log('[patch] 适配器已打过补丁，跳过。');
    } else {
      applyEdits(adapterFile, ADAPTER_EDITS, '适配器');
    }
  }

  if (client) {
    const clientFile = path.resolve(client);
    if (!fs.existsSync(clientFile)) fail('客户端文件不存在: ' + clientFile);
    const clientSrc = fs.readFileSync(clientFile, 'utf8');
    if (clientSrc.includes('fileIconDataUrl')) {
      console.log('[patch] 客户端已打过补丁，跳过。');
    } else {
      applyEdits(clientFile, CLIENT_EDITS, '客户端');
    }
  }

  console.log('[patch] 下一步：重启 dsh web（服务端生效）；刷新浏览器页面（客户端生效，/plugins 路由 no-cache 现读）。');
  console.log('[patch] 发图：落地 %TEMP%\\dsh-incoming-images\\ 并注入路径；发文件：落地 %TEMP%\\dsh-incoming-files\\（保留原始文件名）并注入路径。');
}

module.exports = { IMPORT_EDITS, SCHEMA_OLD, SCHEMA_NEW, FUNC_ANCHOR, FUNC_BLOCK, OLD_FUNC_BLOCK, PROMPT_OLD, PROMPT_NEW, ADAPTER_EDITS, CLIENT_EDITS };

if (require.main === module) main();
