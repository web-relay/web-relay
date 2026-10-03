import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const output = 'packages/sdk/dist';
await rm(output, {recursive:true, force:true});
await mkdir(output, {recursive:true});
await build({
  absWorkingDir:process.cwd(), entryPoints:{ index:'packages/sdk/src/index.ts', extension:'packages/sdk/src/extension.ts' }, outdir:output,
  bundle:true, splitting:true, format:'esm', platform:'browser', target:'es2022', sourcemap:true,
});
const result = spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','packages/sdk/tsconfig.build.json'], {stdio:'inherit'});
if (result.status !== 0) throw new Error('SDK declaration build failed.');
for (const [source, name] of [['sdk/src/index','index'],['sdk/src/extension','extension'],['core/src/index','core'],['protocol/src/index','protocol'],['protocol/src/identities','identities']]) {
  const declaration = (await readFile(`.sdk-types/${source}.d.ts`,'utf8'))
    .replaceAll("'@web-relay/core'", "'./core'").replaceAll("'@web-relay/protocol'", "'./protocol'");
  await writeFile(`${output}/${name}.d.ts`,declaration);
}
await rm('.sdk-types',{recursive:true, force:true});
console.log('Built standalone SDK JavaScript and TypeScript declarations');
