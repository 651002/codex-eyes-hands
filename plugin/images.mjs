import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash = (b)=>createHash('sha256').update(b).digest('hex');
export function createImageProcessor({ sharp, directory, maxPixels = 64000000, maxArtifactsBytes = 268435456, retentionMs = 86400000 }) {
    if (!path.isAbsolute(directory)) throw Error('Image artifact directory must be absolute');
    fs.mkdirSync(directory, {
        recursive: true
    });
    function prune() {
        const files = fs.readdirSync(directory, {
            withFileTypes: true
        }).filter((e)=>e.isFile() && /^[a-f0-9]{64}\.png$/.test(e.name)).map((e)=>{
            const file = path.join(directory, e.name), s = fs.lstatSync(file);
            return {
                file,
                size: s.size,
                time: s.mtimeMs
            };
        }).sort((a, b)=>a.time - b.time);
        let size = files.reduce((n, f)=>n + f.size, 0);
        for (const f of files){
            if (Date.now() - f.time > retentionMs || size > maxArtifactsBytes) {
                fs.unlinkSync(f.file);
                size -= f.size;
            }
        }
    }
    async function put(bytes) {
        prune();
        if (bytes.length > maxArtifactsBytes) throw Error('Image artifact exceeds storage budget');
        const file = path.join(directory, hash(bytes) + '.png');
        if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, {
            mode: 0o600
        });
        return file;
    }
    async function decoded(data) {
        if (data.length > 52428800) throw Error('Image exceeds 50 MiB');
        const img = sharp(data, {
            limitInputPixels: maxPixels,
            animated: false
        }).rotate();
        const meta = await img.metadata();
        if ((meta.pages ?? 1) > 1) throw Error('Animated/multipage images require an explicit frame');
        return img;
    }
    return {
        async prepare (data, { crop, zoom = 1, chunkHeight = 1600, overlap = Math.min(128, Math.floor(chunkHeight / 4)), signal } = {}) {
            signal?.throwIfAborted();
            if (!Number.isFinite(zoom) || zoom < 1 || zoom > 4 || !Number.isInteger(chunkHeight) || chunkHeight < 64 || chunkHeight > 4096 || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkHeight) throw Error('Invalid crop/zoom/chunk options');
            const img = await decoded(data);
            const normal = await img.png().toBuffer();
            const m = await sharp(normal).metadata();
            const width = m.width, height = m.height;
            crop ??= {
                x: 0,
                y: 0,
                width,
                height
            };
            if (!Object.values(crop).every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) throw Error('Crop exceeds source image bounds');
            const targetWidth = Math.round(crop.width * zoom), targetHeight = Math.round(crop.height * zoom);
            if (targetWidth * targetHeight > maxPixels || targetWidth > 8192) throw Error('Image transform exceeds pixel budget');
            const chunks = [];
            const step = chunkHeight - overlap;
            for(let y = 0; y < targetHeight; y += step){
                const h = Math.min(chunkHeight, targetHeight - y);
                chunks.push({
                    y,
                    h
                });
                if (y + h === targetHeight) break;
            }
            if (chunks.length > 16) throw Error('Long screenshot exceeds 16 chunks; crop a smaller region');
            const region = await sharp(normal).extract({
                left: crop.x,
                top: crop.y,
                width: crop.width,
                height: crop.height
            }).resize(targetWidth, targetHeight, {
                kernel: 'nearest'
            }).png().toBuffer();
            const images = [];
            for (const c of chunks){
                signal?.throwIfAborted();
                const b = await sharp(region).extract({
                    left: 0,
                    top: c.y,
                    width: targetWidth,
                    height: c.h
                }).png().toBuffer();
                images.push({
                    path: await put(b),
                    width: targetWidth,
                    height: c.h,
                    offsetX: crop.x,
                    offsetY: crop.y + c.y / (targetHeight / crop.height),
                    scaleX: targetWidth / crop.width,
                    scaleY: targetHeight / crop.height
                });
            }
            return {
                width,
                height,
                images
            };
        },
        async diff (before, after, { threshold = 16, signal } = {}) {
            signal?.throwIfAborted();
            if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw Error('Invalid pixel threshold');
            const a = await (await decoded(before)).ensureAlpha().raw().toBuffer({
                resolveWithObject: true
            }), b = await (await decoded(after)).ensureAlpha().raw().toBuffer({
                resolveWithObject: true
            });
            if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw Error('Image dimensions differ / 图片尺寸不同，未自动缩放');
            let changed = 0, minX = a.info.width, minY = a.info.height, maxX = -1, maxY = -1;
            const out = Buffer.alloc(a.info.width * a.info.height * 4);
            for(let i = 0; i < a.data.length; i += 4){
                if (i % 400000 === 0) signal?.throwIfAborted();
                const aa = a.data[i + 3] / 255, ba = b.data[i + 3] / 255;
                const delta = Math.max(...[
                    0,
                    1,
                    2
                ].map((c)=>Math.abs(Math.round(a.data[i + c] * aa + 255 * (1 - aa)) - Math.round(b.data[i + c] * ba + 255 * (1 - ba)))));
                const hit = delta > threshold;
                const pixel = i / 4, x = pixel % a.info.width, y = Math.floor(pixel / a.info.width);
                if (hit) {
                    changed++;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
                out[i] = hit ? 230 : 160;
                out[i + 1] = hit ? 60 : 160;
                out[i + 2] = hit ? 70 : 160;
                out[i + 3] = 255;
            }
            const bytes = await sharp(out, {
                raw: {
                    width: a.info.width,
                    height: a.info.height,
                    channels: 4
                }
            }).png().toBuffer();
            return {
                width: a.info.width,
                height: a.info.height,
                threshold,
                changedPixels: changed,
                changedRatio: changed / (a.info.width * a.info.height),
                bounds: changed ? {
                    x: minX,
                    y: minY,
                    width: maxX - minX + 1,
                    height: maxY - minY + 1
                } : null,
                artifact: await put(bytes),
                note: '像素差异仅是视觉证据，不代表功能测试通过。'
            };
        }
    };
}
