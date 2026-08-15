[English](dsh-image-gateway.en.md) | 中文

# DSH 附件网关补丁（可选，供 DeepSeek Harness 用户）

v1.2.1：支持**图片 + 任意文件**（zip/exe/pdf/docx/…）上传，全部落地成文件、以路径文本注入 agent 消息。

## 背景

DSH 的 agent 若使用无视觉模型（`inputModalities` 不含 `image`），用户在 Web 里发图片时，
`dsh-host-apiproxy` 的 `prompt` 处理器会直接返回 `MODEL_DOES_NOT_SUPPORT_IMAGES`，
客户端弹「当前模型不支持图片」，图片根本到不了 agent。
而 Web 客户端的附件白名单只有 4 种图片（PNG/JPG/WebP/GIF），发其他文件会弹「仅支持 PNG、JPG、WebP、GIF 格式的图片」。

## 思路

不把附件喂给模型。改为：**附件落地成文件 + 把绝对路径以文本块注入消息**，
agent 拿到路径后交给 codex-bridge（`see` 看图 / `read` 读文件 / pwsh 解压分析）。

- 图片 → `%TEMP%\dsh-incoming-images\<uuid>.<扩展名>`（对话记录仍显示缩略图）
- 其他文件 → `%TEMP%\dsh-incoming-files\<uuid>-<原始文件名>`（文件名消毒 + 扩展名映射，防路径穿越）

## 改动文件

1. `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（网关，必须）
2. `node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`（适配器，可选，推荐：对话记录显示图片缩略图）
3. `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（客户端，必须：放开附件白名单）

三个文件都是打包产物，直接改即可。**一键脚本**见仓库 `patches/apply-dsh-gateway-patch.js`：

```bash
node patches/apply-dsh-gateway-patch.js ^
  <dsh>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js ^
  <dsh>/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js ^
  <dsh>/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
```

脚本幂等（重复执行自动跳过已打部分）、自动备份、失败自动回滚。

## 网关改动明细

### 1. 顶部 import 增加 `writeFile`、`join`、`tmpdir`

```js
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { release, tmpdir } from "node:os";
```

### 2. `prompt` 处理器：把「拒绝」改成「按模型能力分流」

改前：

```js
if (hasImage) {
	const current = selectionFor(agent).current;
	const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);
	if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {
		code: "attachment-error",
		message: `Model "${current.model}" does not support image input.`,
		details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }
	});
}
const message = createUserMessage({
	content: await durablePromptContent(ctx, content),
	source
});
```

改后：

```js
let durable;
if (hasImage) {
	const current = selectionFor(agent).current;
	const modelInfo = await ctx.llm.resolveModelInfo(current.provider, current.model);
	const supportsImage = modelInfo.inputModalities === void 0 || modelInfo.inputModalities.includes("image");
	durable = supportsImage ? await durablePromptContent(ctx, content) : await materializeImageContent(ctx, content);
} else {
	durable = await durablePromptContent(ctx, content);
}
const message = createUserMessage({
	content: durable,
	source
});
```

### 3. 放宽 prompt schema（v1.2.1）

`promptContentPartSchema` 里图片 part 的 `mediaType` 从「4 种图片白名单」放宽为任意字符串，
否则非图片文件会被 RPC 层直接拒绝：

```js
// 改前
mediaType: imageMediaTypeSchema,
// 改后
mediaType: z$1.string(),
```

### 4. 新增 `materializeImageContent`（v1.2.1 版，图片 + 文件）

完整代码见 `apply-dsh-gateway-patch.js` 的 `FUNC_BLOCK`（约 100 行，含 `imageExtension` /
`fileExtension` / `sanitizeFileName` 三个辅助函数）。要点：

- 图片 part：写 `%TEMP%\dsh-incoming-images\`，保留 `saveImage` 附件块（UI 缩略图）+ 注入路径文本；
- 非图片 part：写 `%TEMP%\dsh-incoming-files\<uuid>-<消毒后的原始文件名>`，**不**建图片附件块，只注入路径文本；
- 扩展名：原始文件名的扩展名优先，否则按 MIME 映射（zip/7z/rar/tar/gz/pdf/txt/md/json/xml/csv/docx/xlsx/pptx/apk/bin…）。

## 让对话记录显示图片缩略图（可选，推荐）

上面的补丁会让消息里**保留图片块**（存入附件库），但 `dsh-llm-deepseek` 适配器遇到图片块会直接报错。
再给适配器打一个「图片块降级为占位符」的小补丁，模型就不会收到图片、而对话 UI 能显示缩略图：

文件：`node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`

```js
// 1) flattenText：图片块降级为占位符
/** Join the text blocks of a message; image blocks degrade to a placeholder so the model never sees raw image content. */
function flattenText(blocks) {
	return blocks.map((block) => block.type === "text" ? block.text : block.type === "image" ? "(image omitted: model does not support images)" : "").join("");
}

// 2) serializeMessages 里删掉这行（原为「遇图报错」）
// 		assertTextOnly(message.content);
```

## 客户端改动明细（v1.2.1，必须）

文件：`node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（该文件经 `/plugins/<id>/client.js`
路由 no-cache 现读，改完**刷新页面**即可生效，无需重新构建）

1. `imageMediaType`：非图片 MIME 放行（空 MIME 按 `application/octet-stream`），不再抛
   `UnsupportedImageMediaTypeError`（这就是「仅支持 PNG、JPG、WebP、GIF 格式的图片」弹窗的来源）；
2. `browserDraftAttachment`：非图片附件用 SVG 文件图标 data URL 当缩略图（图片仍用对象 URL）；
3. `intakeImages`：非图片文件 100MB 上限（超限提示）；
4. 附件栏 `onOpen`：非图片附件不弹图片灯箱。

## 生效

- 网关/适配器（服务端）：重启 `dsh web` 生效。
- 客户端：刷新浏览器页面生效。

重启/刷新后：

- 发图：图片 → `%TEMP%\dsh-incoming-images\` → 对话显示缩略图 + 路径文本 → agent 用 codex-bridge `see` 看图。
- 发文件：文件 → `%TEMP%\dsh-incoming-files\`（保留原始文件名）→ 路径文本 → agent 用 pwsh / codex-bridge
  `read`、`see` 解压、读取、分析后回答。

## 注意事项

- `%TEMP%\dsh-incoming-images\`、`%TEMP%\dsh-incoming-files\` 会累积旧文件，可用 codex-bridge 的 `clean` 模式定期清理。
- 视觉模型不受影响（仍走原来的 `durablePromptContent` 附件存储路径）。
- 版本更新（`npm install` 升级 dsh 包）后这些文件会被覆盖，需重打补丁。
