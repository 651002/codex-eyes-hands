import {StringDecoder} from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
export function createLocalOcr({ executable, language = 'eng', timeoutMs = 60000, maxOutputBytes = 4194304 }) {
    if (!executable || !path.isAbsolute(executable) || !/\.exe$/i.test(executable) && process.platform === 'win32' || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw Error('本地 OCR 未配置：请填写已有 Tesseract 可执行文件的绝对路径；不会自动安装。');
    if (!/^[a-zA-Z0-9_+.-]+$/.test(language)) throw Error('Invalid OCR language');
    return async ({ images, signal })=>{
        const text = [], uncertainties = [];
        for (const [imageIndex, img] of images.entries()){
            signal?.throwIfAborted();
            const tsv = await new Promise((resolve, reject)=>{
                let output = '', bytes = 0, finished = false;
                const decoder = new StringDecoder('utf8');
                const child = spawn(executable, [
                    img.path,
                    'stdout',
                    '-l',
                    language,
                    'tsv'
                ], {
                    windowsHide: true,
                    stdio: [
                        'ignore',
                        'pipe',
                        'pipe'
                    ],
                    shell: false
                });
                const end = (error, value)=>{
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abort);
                    if (error) {
                        child.kill();
                        reject(error);
                    } else resolve(value);
                };
                const abort = ()=>end(signal.reason || Error('OCR cancelled'));
                const timer = setTimeout(()=>end(Error('Local OCR timed out')), timeoutMs);
                signal?.addEventListener('abort', abort, {
                    once: true
                });
                child.stdout.on('data', (b)=>{
                    bytes += b.length;
                    if (bytes > maxOutputBytes) return end(Error('OCR output exceeds limit'));
                    output += decoder.write(b);
                });
                child.stderr.on('data', ()=>{});
                child.once('error', ()=>end(Error('Local OCR executable failed to start')));
                child.once('close', (code)=>code === 0 ? end(null, output + decoder.end()) : end(Error('Local OCR failed with exit ' + code)));
                if (signal?.aborted) abort();
            });
            const parsed = parseOcrTsv(tsv, img, imageIndex);
            text.push(...parsed.text);
            uncertainties.push(...parsed.uncertainties);
        }
        return {
            overview: '本地 OCR 文字提取，不包含语义画面理解。',
            text,
            elements: [],
            uncertainties
        };
    };
}
export function parseOcrTsv(tsv, img, imageIndex = 0) {
    const text = [], uncertainties = [];
    for (const line of tsv.split(/\r?\n/).slice(1)){
        const cols = line.split('\t');
        if (cols.length < 12 || cols[0] !== '5') continue;
        const word = cols.slice(11).join('\t').trim();
        if (!word) continue;
        const [x, y, width, height, confidence] = [
            6,
            7,
            8,
            9,
            10
        ].map((i)=>Number(cols[i]));
        if (![
            x,
            y,
            width,
            height,
            confidence
        ].every(Number.isFinite) || x < 0 || y < 0 || width < 0 || height < 0 || x + width > img.width || y + height > img.height) continue;
        if (confidence < 60) uncertainties.push('低置信度文字：' + word);
        text.push({
            text: word,
            imageIndex,
            box: [
                x,
                y,
                width,
                height
            ],
            confidence
        });
    }
    return {
        text,
        uncertainties
    };
}
