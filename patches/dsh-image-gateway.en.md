[中文](dsh-image-gateway.md) | English

# DSH Image Gateway Patch (optional, for DeepSeek Harness users)

## Background

When a Harness agent runs a text-only model (`inputModalities` without `image`), the `prompt`
handler of `dsh-host-apiproxy` rejects image messages with `MODEL_DOES_NOT_SUPPORT_IMAGES`,
and the client shows "current model does not support images" — the image never reaches the agent.

## Idea

Don't feed the image to the model. Instead: **materialize the image to a file and inject its
absolute path into the message as a text block**, so the agent can hand the path to the
codex-bridge `see` mode (local Codex CLI image analysis).

## File to change

`node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js` (the package ships as a bundle; edit this file directly).

### 1. Add `writeFile`, `join`, `tmpdir` to the top imports

```js
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { release, tmpdir } from "node:os";
```

### 2. Add the `materializeImageContent` function (right after `durablePromptContent`)

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
async function materializeImageContent(ctx, content) {
	const dir = join(tmpdir(), "dsh-incoming-images");
	await mkdir(dir, { recursive: true });
	const blocks = [];
	for (const part of content) {
		if (part.type === "text") {
			blocks.push({ type: "text", text: part.text });
			continue;
		}
		const file = join(dir, `${randomUUID()}${imageExtension(part.mediaType)}`);
		const data = decodeBase64(part.data);
		await writeFile(file, data);
		const name = part.name === void 0 ? file : part.name;
		let attachment;
		try {
			attachment = await ctx.attachments.saveImage({
				data,
				mediaType: part.mediaType,
				...part.name === void 0 ? {} : { name: part.name }
			});
		} catch { /* UI 展示失败不影响主流程 */ }
		if (attachment !== void 0) blocks.push({ type: "image", attachment });
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

### 3. In the `prompt` handler: replace "reject" with "route by model capability"

Before:

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

After:

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

## Showing image thumbnails in the conversation (optional, recommended)

The patch above keeps the image block in the message (saved to the attachment store), but the
`dsh-llm-deepseek` adapter throws on image blocks. Apply one more small patch so image blocks
degrade to a placeholder instead — the model never sees raw images while the chat UI shows thumbnails:

File: `node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`

```js
// 1) flattenText: degrade image blocks to a placeholder
/** Join the text blocks of a message; image blocks degrade to a placeholder so the model never sees raw image content. */
function flattenText(blocks) {
	return blocks.map((block) => block.type === "text" ? block.text : block.type === "image" ? "(image omitted: model does not support images)" : "").join("");
}

// 2) in serializeMessages, remove this line (previously "throw on image")
// 		assertTextOnly(message.content);
```

After that: sending an image → the user message shows an **image thumbnail** plus the path text →
the agent analyzes it via Codex → answers normally.

## Taking effect

The file is bundled JS and is loaded into memory at process start — **restart `dsh web`** to apply.
After the restart, sending an image works like this: image → saved under `%TEMP%\dsh-incoming-images\`
→ the path enters the agent message as text → the agent analyzes it with codex-bridge `see` → answers you.

## Notes

- `%TEMP%\dsh-incoming-images\` accumulates; clean it periodically with the codex-bridge `clean` mode.
- Vision models are unaffected (they still use the original `durablePromptContent` attachment path).
- A package upgrade (`npm install` of the dsh packages) overwrites this file — re-apply the patch.
