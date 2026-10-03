import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.test', { recursive: true });
await build({ entryPoints: ['tests/contracts.test.ts'], outfile: '.test/contracts.test.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const result = spawnSync(process.execPath, ['--test', '.test/contracts.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
