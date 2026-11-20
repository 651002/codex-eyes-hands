import { digest } from './vision-cache.mjs';
const MODEL_BLOCK = {
    type: 'object',
    additionalProperties: false,
    properties: {
        text: {
            type: 'string'
        },
        imageIndex: {
            type: 'integer',
            minimum: 0
        },
        box: {
            anyOf: [
                {
                    type: 'array',
                    items: {
                        type: 'number'
                    },
                    minItems: 4,
                    maxItems: 4
                },
                {
                    type: 'null'
                }
            ]
        }
    },
    required: [
        'text',
        'imageIndex',
        'box'
    ]
};
export const VISION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        overview: {
            type: 'string'
        },
        text: {
            type: 'array',
            items: MODEL_BLOCK
        },
        elements: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    label: {
                        type: 'string'
                    },
                    role: {
                        type: 'string'
                    },
                    imageIndex: {
                        type: 'integer',
                        minimum: 0
                    },
                    box: {
                        anyOf: [
                            {
                                type: 'array',
                                items: {
                                    type: 'number'
                                },
                                minItems: 4,
                                maxItems: 4
                            },
                            {
                                type: 'null'
                            }
                        ]
                    }
                },
                required: [
                    'label',
                    'role',
                    'imageIndex',
                    'box'
                ]
            }
        },
        uncertainties: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    },
    required: [
        'overview',
        'text',
        'elements',
        'uncertainties'
    ]
};
function boxInSource(box, index, images) {
    if (box === null || box === undefined) return null;
    const img = images[index];
    if (!img || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box.some((x)=>x < 0) || box[0] + box[2] > img.width + 0.001 || box[1] + box[3] > img.height + 0.001) throw Error('Invalid structured vision coordinates');
    return [
        img.offsetX + box[0] / img.scaleX,
        img.offsetY + box[1] / img.scaleY,
        box[2] / img.scaleX,
        box[3] / img.scaleY
    ].map((v)=>Math.round(v * 1000) / 1000);
}
export function validateVision(value, images) {
    if (typeof value === 'string') {
        if (Buffer.byteLength(value) > 524288) throw Error('Structured vision result too large');
        try {
            value = JSON.parse(value.replace(/^\s*\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60\s*$/, ''));
        } catch  {
            throw Error('Codex 未返回有效的结构化视觉 JSON');
        }
    }
    if (!value || typeof value.overview !== 'string' || !Array.isArray(value.text) || !Array.isArray(value.elements) || !Array.isArray(value.uncertainties) || value.uncertainties.some((x)=>typeof x !== 'string')) throw Error('Invalid structured vision schema / 结构化结果不完整');
    if (Buffer.byteLength(JSON.stringify(value)) > 524288 || value.text.length > 10000 || value.elements.length > 2000) throw Error('Structured vision result too large');
    const remap = (items, field)=>items.map((block)=>{
            if (typeof block?.[field] !== 'string' || !Number.isInteger(block.imageIndex) || !images[block.imageIndex]) throw Error('Invalid structured vision block');
            return {
                ...block,
                box: boxInSource(block.box, block.imageIndex, images)
            };
        });
    const dedupe = (items, key)=>items.filter((item, i)=>!items.slice(0, i).some((old)=>old[key] === item[key] && old.imageIndex !== item.imageIndex && old.box && item.box && old.box.every((v, j)=>Math.abs(v - item.box[j]) <= 3)));
    return {
        overview: value.overview,
        text: dedupe(remap(value.text, 'text'), 'text'),
        elements: dedupe(remap(value.elements, 'label'), 'label'),
        uncertainties: value.uncertainties
    };
}
export class VisionEngine {
    constructor({ cache, prepare, analyze, fingerprint = ()=>'', localOcr, cacheEnabled = true }){
        Object.assign(this, {
            cache,
            prepare,
            analyzeWorker: analyze,
            fingerprint,
            localOcr,
            cacheEnabled
        });
    }
    async analyze(request) {
        request.signal?.throwIfAborted();
        const { scope, data } = request;
        if (typeof scope !== 'string' || !scope.trim()) throw Error('Vision requires a session scope');
        const mode = request.mode ?? 'see';
        if (![
            'see',
            'ocr'
        ].includes(mode)) throw Error('Only pure vision modes see/ocr may be cached');
        if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 52428800) throw Error('Image input must be 1 byte to 50 MiB');
        const backend = request.backend ?? 'codex';
        if (![
            'codex',
            'local-ocr'
        ].includes(backend) || backend === 'local-ocr' && mode !== 'ocr') throw Error('Invalid vision backend');
        if (typeof request.question !== 'undefined' && typeof request.question !== 'string') throw Error('Invalid question');
        const identity = digest(data), fingerprint = await this.fingerprint(backend);
        const question = request.question ?? (mode === 'ocr' ? '逐字识别图片中的文字；看不清的内容列入 uncertainties。' : '描述画面、关键文字和控件，明确哪些细节看不清。');
        const key = JSON.stringify({
            v: 1,
            identity,
            fingerprint,
            mode,
            backend,
            question,
            crop: request.crop ?? null,
            zoom: request.zoom ?? 1,
            chunkHeight: request.chunkHeight ?? 1600,
            overlap: request.overlap ?? null
        });
        const enabled = this.cacheEnabled && request.cache !== false;
        if (enabled) {
            const hit = this.cache.get(scope, key);
            if (hit) {
                return {
                    ...hit,
                    source: {
                        ...hit.source,
                        path: request.sourcePath ?? null
                    },
                    cache: {
                        hit: true,
                        source: 'cache',
                        codexRunsStarted: 0,
                        note: '命中本会话识别缓存，未启动新的 Codex 识别任务；不代表 DSH 后续回答免费。'
                    }
                };
            }
        }
        const produce = async (signal)=>{
            signal.throwIfAborted();
            const prepared = await this.prepare(data, {
                ...request,
                signal
            });
            const worker = backend === 'local-ocr' ? this.localOcr : this.analyzeWorker;
            if (!worker) throw Error('Local OCR 未配置；请指定已有 OCR 程序，或显式选择 Codex');
            const value = await worker({
                prepared,
                images: prepared.images,
                question,
                mode,
                signal
            });
            signal.throwIfAborted();
            const memo = {
                schemaVersion: 1,
                source: {
                    sha256: identity,
                    path: request.sourcePath ?? null,
                    width: prepared.width,
                    height: prepared.height
                },
                ...validateVision(value, prepared.images),
                coordinates: {
                    unit: 'source-image-pixels',
                    box: 'x,y,width,height'
                },
                evidence: {
                    images: prepared.images.map((x)=>({
                            path: x.path,
                            width: x.width,
                            height: x.height,
                            offsetX: x.offsetX,
                            offsetY: x.offsetY,
                            scaleX: x.scaleX,
                            scaleY: x.scaleY
                        }))
                }
            };
            if (enabled) this.cache.put(scope, key, memo);
            return memo;
        };
        const value = enabled ? await this.cache.share(scope, key, request.signal, produce) : await produce(request.signal ?? new AbortController().signal);
        return {
            ...value,
            cache: {
                hit: false,
                source: backend,
                codexRunsStarted: backend === 'codex' ? 1 : 0,
                note: backend === 'codex' ? '本次启动 Codex 识别；未估算模型费用。' : '本次使用本地 OCR，不启动 Codex 识别。'
            }
        };
    }
}
