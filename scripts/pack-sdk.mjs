import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../',import.meta.url));
const output = fileURLToPath(new URL('../artifacts/',import.meta.url));
await mkdir(output,{recursive:true});
const result = spawnSync('pnpm',['--filter','@web-relay/sdk','pack','--pack-destination',output],{cwd:root,stdio:'inherit'});
process.exitCode = result.status ?? 1;
