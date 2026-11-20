import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentTask } from '../plugin/attachments.mjs';
import { fileURLToPath } from 'node:url';
test('empty tasks fail before any delegate starts', ()=>assert.throws(()=>attachmentTask(' ', [], {}), /具体任务/));
test('image path comes from attachment service, not filename guessing', ()=>{
    const p = fileURLToPath(import.meta.url);
    const s = attachmentTask('describe image', [
        {
            type: 'image',
            attachment: {
                name: 'untrusted'
            }
        }
    ], {
        imageHostPath: ()=>p
    });
    assert.ok(s.includes(JSON.stringify(p)));
    assert.ok(!s.includes('untrusted'));
});
test('non-local or missing attachment fails instead of silently dropping it', ()=>assert.throws(()=>attachmentTask('read', [
            {
                type: 'file',
                attachment: {}
            }
        ], {
            fileHostPath: ()=>undefined
        }), /本地路径/));
test('text-only handoff contains task scope and does not invent authorization', ()=>{
    const s = attachmentTask('Read README', [], {});
    assert.ok(s.startsWith('Read README'));
    assert.ok(s.includes('不是额外授权'));
    assert.ok(!s.includes('全权授权'));
});
