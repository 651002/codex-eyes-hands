# DSH 图片网关补丁（可选，供 DeepSeek Harness 用户）

## 背景

DSH 的 agent 若使用无视觉模型（`inputModalities` 不含 `image`），用户在 Web 里发图片时，
`dsh-host-apiproxy` 的 `prompt` 处理器会直接返回 `MODEL_DOES_NOT_SUPPORT_IMAGES`，
客户端弹「当前模型不支持图片」，图片根本到不了 agent。

## 思路

不把图片喂给模型。改为：**图片落地成文件 + 把绝对路径以文本块注入消息**，
agent 拿到路径后交给 codex-bridge 的 `see` 模式（本机 Codex CLI 挂图分析）。

## 改动文件

`node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`（该包发布为打包产物，直接改这个文件即可）。

### 1. 顶部 import 增加 `writeFile`、`join`、`tmpdir`

```js
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { release, tmpdir } from "node:os";
```

### 2. 新增 `materializeImageContent` 函数（放在 `durablePromptContent` 定义之后）

```js
/** Extension for an image media type, used when materializing to disk. */
function imageExtension(mediaType) {
	switch (mediaType) {
		case "image/png": return ".png";
		case "image/jpeg": return ".jpg";
		case "image/webp": return ".webp";
		case "image/gif": return ".gif";
		default: return "";
	}
}
/**
 * Materialize image parts to on-disk files and rewrite them as text pointers.
 * A model that cannot accept image input must never receive an image part.
 */
async function materializeImageContent(content) {
	const dir = join(tmpdir(), "dsh-incoming-images");
	await mkdir(dir, { recursive: true });
	const blocks = [];
	for (const part of content) {
		if (part.type === "text") {
			blocks.push({ type: "text", text: part.text });
			continue;
		}
		const file = join(dir, `${randomUUID()}${imageExtension(part.mediaType)}`);
		await writeFile(file, decodeBase64(part.data));
		const name = part.name === void 0 ? file : part.name;
		blocks.push({
			type: "text",
			text: [
				"[图片附件] 用户在本条消息附带了一张图片（当前模型无法直接查看图片内容）。",
				`原始文件名: ${name}`,
				`本地文件绝对路径: ${file}`,
				"请用 codex-bridge 技能调用本机 codex CLI 分析该图片文件，拿到文字结果后再回答用户。"
			].join("\n")
		});
	}
	return blocks;
}
```

### 3. `prompt` 处理器：把「拒绝」改成「按模型能力分流」

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
	durable = supportsImage ? await durablePromptContent(ctx, content) : await materializeImageContent(content);
} else {
	durable = await durablePromptContent(ctx, content);
}
const message = createUserMessage({
	content: durable,
	source
});
```

## 生效

该文件是打包 JS、进程启动时已加载到内存，改完需要**重启 `dsh web`** 才生效。
重启后发图：图片 → 落到 `%TEMP%\dsh-incoming-images\` → 路径以文本进入 agent 消息
→ agent 用 codex-bridge `see` 调 Codex 看图 → 回答用户。

## 注意事项

- `%TEMP%\dsh-incoming-images\` 会累积旧图，可用 codex-bridge 的 `clean` 模式定期清理。
- 视觉模型不受影响（仍走原来的 `durablePromptContent` 附件存储路径）。
- 版本更新（`npm install` 升级 dsh 包）后该文件会被覆盖，需重打补丁。
