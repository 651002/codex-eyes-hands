import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.env.DSH_TEST_INSTALL_DIR;
if (!root) throw Error('Set DSH_TEST_INSTALL_DIR to the actual DSH package root.');
const host = createRequire(path.join(root, 'package.json'));
const prefix = pathToFileURL(root + path.sep).href;
registerHooks({
    resolve (spec, ctx, next) {
        if (spec.startsWith('@deepseek-ai/') && !ctx.parentURL?.startsWith(prefix)) {
            const f = host.resolve(spec);
            return next(Array.from(ctx.conditions || []).includes('require') ? f : pathToFileURL(f).href, ctx);
        }
        return next(spec, ctx);
    }
});
