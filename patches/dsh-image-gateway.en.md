[中文](dsh-image-gateway.md) | English

# DSH Attachment Gateway Patch (optional, for DeepSeek Harness users)

v1.2.1: supports **images + arbitrary files** (zip/exe/pdf/docx/…) — every attachment is materialized
to a file and its absolute path is injected into the agent message as text.

## Background

When a Harness agent runs a text-only model (`inputModalities` without `image`), the `prompt`
handler of `dsh-host-apiproxy` rejects image messages with `MODEL_DOES_NOT_SUPPORT_IMAGES`, and
the client shows "current model does not support images". Besides, the Web client's attachment
whitelist only allows 4 image types (PNG/JPG/WebP/GIF); any other file triggers
"Only PNG, JPG, WebP, and GIF images are supported".

## Idea

Don't feed the attachment to the model. Instead: **materialize it to a file and inject its absolute
path into the message as a text block**, so the agent can hand the path to codex-bridge
(`see` for images / `read` for files / pwsh to extract and analyze).

- Images → `%TEMP%\dsh-incoming-images\<uuid>.<ext>` (the conversation still shows a thumbnail)
- Other files → `%TEMP%\dsh-incoming-files\<uuid>-<original name>` (name sanitized, extension mapped)

## Files to change

1. `node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js` (gateway, required)
2. `node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js` (adapter, optional but recommended: thumbnails in history)
3. `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` (client, required: lifts the attachment whitelist)

All three are shipped bundles — edit them directly. **One-click script** at `patches/apply-dsh-gateway-patch.js`:

```bash
node patches/apply-dsh-gateway-patch.js \
  <dsh>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js \
  <dsh>/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js \
  <dsh>/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
```

The script is idempotent (skips already-patched parts), backs up every file, and rolls back on any mismatch.

## Gateway changes

### 1. Add `writeFile`, `join`, `tmpdir` to the top imports

```js
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { release, tmpdir } from "node:os";
```

### 2. In the `prompt` handler: replace "reject" with "route by model capability"

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

### 3. Widen the prompt schema (v1.2.1)

In `promptContentPartSchema`, the image part's `mediaType` goes from the 4-image whitelist to any
string — otherwise the RPC layer rejects non-image files outright:

```js
// before
mediaType: imageMediaTypeSchema,
// after
mediaType: z$1.string(),
```

### 4. Add `materializeImageContent` (v1.2.1 version: images + files)

See `FUNC_BLOCK` in `apply-dsh-gateway-patch.js` for the full ~100-line block (with the
`imageExtension` / `fileExtension` / `sanitizeFileName` helpers). Key points:

- Image parts: written to `%TEMP%\dsh-incoming-images\`, keep the `saveImage` attachment block
  (UI thumbnail) plus the injected path text;
- Non-image parts: written to `%TEMP%\dsh-incoming-files\<uuid>-<sanitized original name>`,
  **no** image attachment block, only the path text;
- Extension: the original file name's extension wins, otherwise the MIME map
  (zip/7z/rar/tar/gz/pdf/txt/md/json/xml/csv/docx/xlsx/pptx/apk/bin…).

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

## Client changes (v1.2.1, required)

File: `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` — served through the
`/plugins/<id>/client.js` route with `no-cache`, so **a page refresh** applies it; no rebuild needed.

1. `imageMediaType`: pass through non-image MIME types (empty MIME becomes
   `application/octet-stream`) instead of throwing `UnsupportedImageMediaTypeError`
   (the source of the "Only PNG, JPG, WebP, and GIF images are supported" toast);
2. `browserDraftAttachment`: non-image attachments get an SVG file-icon data URL thumbnail
   (images keep object URLs);
3. `intakeImages`: 100MB cap for non-image files;
4. Attachment rail `onOpen`: don't open the image lightbox for non-image attachments.

## Taking effect

- Gateway/adapter (server side): **restart `dsh web`**.
- Client: refresh the browser page.

After that:

- Sending an image → `%TEMP%\dsh-incoming-images\` → thumbnail in history + path text →
  the agent analyzes it via codex-bridge `see`.
- Sending a file → `%TEMP%\dsh-incoming-files\` (original name kept) → path text →
  the agent extracts/reads/analyzes it via pwsh or codex-bridge `read`/`see`.

## Notes

- `%TEMP%\dsh-incoming-images\` and `%TEMP%\dsh-incoming-files\` accumulate; clean them
  periodically with the codex-bridge `clean` mode.
- Vision models are unaffected (they still use the original `durablePromptContent` attachment path).
- A package upgrade (`npm install` of the dsh packages) overwrites these files — re-apply the patch.
