import { createRequire } from 'node:module';
import path from 'node:path';
const root = process.env.DSH_TEST_INSTALL_DIR;
if (!root) throw Error('Set DSH_TEST_INSTALL_DIR to the actual DSH package root.');
const host = createRequire(path.join(root, 'package.json'));
const { Context } = host('@deepseek-ai/cordis');
const { createRuntimeResolution, PluginPackages } = host('@deepseek-ai/dsh-app-boot');
const project = path.resolve(import.meta.dirname, '..');
// Exercise the same linked-package peer rules as DSH; never redirect every import.
const base = await createRuntimeResolution({ installAnchor: path.join(root, 'package.json') });
const resolution = {
    ...base,
    linkedRoots: [...base.linkedRoots, { name: 'dsh-codex-eyes-hands', realPath: project }],
};
new PluginPackages(new Context(), { resolution });
