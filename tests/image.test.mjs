import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createImageProcessor } from '../plugin/images.mjs';
import { createRequire } from 'node:module';
const root = process.env.DSH_TEST_INSTALL_DIR;
const require = createRequire(path.join(root, 'package.json'));
const sharp = require('sharp');
const parent = process.env.CODEX_EYES_HANDS_TEST_ROOT || path.join(os.tmpdir(), 'codex-eyes-hands-tests');
fs.mkdirSync(parent, {
    recursive: true
});
const dir = fs.mkdtempSync(path.join(parent, 'pixels-'));
test.after(()=>{
    const rel = path.relative(parent, dir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(dir, {
        recursive: true,
        force: true
    });
});
const images = createImageProcessor({
    sharp,
    directory: dir
});
test('crop and zoom keep exact original pixel coordinate mapping', async ()=>{
    const data = await sharp({
        create: {
            width: 100,
            height: 100,
            channels: 4,
            background: '#ff0000'
        }
    }).png().toBuffer();
    const p = await images.prepare(data, {
        crop: {
            x: 10,
            y: 20,
            width: 30,
            height: 40
        },
        zoom: 2,
        chunkHeight: 100
    });
    assert.equal(p.images[0].width, 60);
    assert.equal(p.images[0].height, 80);
    assert.equal(p.images[0].offsetX, 10);
    assert.equal(p.images[0].offsetY, 20);
    assert.equal(p.images[0].scaleX, 2);
});
test('long screenshot chunks cover every row with bounded overlap', async ()=>{
    const data = await sharp({
        create: {
            width: 80,
            height: 3000,
            channels: 3,
            background: '#ffffff'
        }
    }).png().toBuffer();
    const p = await images.prepare(data, {
        chunkHeight: 1000,
        overlap: 100
    });
    assert.equal(p.images.length, 4);
    assert.deepEqual(p.images.map((i)=>i.offsetY), [
        0,
        900,
        1800,
        2700
    ]);
    assert.equal(p.images.at(-1).height, 300);
});
test('invalid and overbudget crop/zoom are rejected', async ()=>{
    const b = await sharp({
        create: {
            width: 20,
            height: 20,
            channels: 3,
            background: '#ffffff'
        }
    }).png().toBuffer();
    await assert.rejects(images.prepare(b, {
        crop: {
            x: 19,
            y: 0,
            width: 5,
            height: 5
        }
    }));
    await assert.rejects(images.prepare(b, {
        zoom: 100
    }));
});
test('pixel diff reports exact changed ratio, box, and artifact', async ()=>{
    const a = await sharp({
        create: {
            width: 10,
            height: 10,
            channels: 4,
            background: '#ffffff'
        }
    }).png().toBuffer();
    const patch = await sharp({
        create: {
            width: 2,
            height: 2,
            channels: 4,
            background: '#000000'
        }
    }).png().toBuffer();
    const b = await sharp(a).composite([
        {
            input: patch,
            left: 3,
            top: 4
        }
    ]).png().toBuffer();
    const d = await images.diff(a, b, {
        threshold: 0
    });
    assert.equal(d.changedPixels, 4);
    assert.equal(d.changedRatio, 0.04);
    assert.deepEqual(d.bounds, {
        x: 3,
        y: 4,
        width: 2,
        height: 2
    });
    assert.ok(fs.existsSync(d.artifact));
    const same = await images.diff(a, a);
    assert.equal(same.changedPixels, 0);
    assert.equal(same.bounds, null);
});
test('different dimensions are explicit, never silently resized', async ()=>{
    const make = (w)=>sharp({
            create: {
                width: w,
                height: 10,
                channels: 3,
                background: '#ffffff'
            }
        }).png().toBuffer();
    await assert.rejects(images.diff(await make(10), await make(11)), /dimension|尺寸/);
});
