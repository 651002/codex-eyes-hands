import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.DSH_TEST_EXECUTABLE || process.execPath;
const result = spawnSync(exe, [
    '--import',
    pathToFileURL(path.join(root, 'tests/host-bootstrap.mjs')).href,
    '--test',
    ...[
        'host.test.mjs',
        'image.test.mjs',
        'vision-host.test.mjs', 'maintenance-host.test.mjs'
    ].map((f)=>path.join(root, 'tests', f))
], {
    env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: 'inherit',
    windowsHide: true
});
process.exit(result.status ?? 1);
