import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const targets = [
  ['demo-pwa', 'main'],
  ['launcher-extension', 'background'],
  ['webapp-extension', 'background'],
];
for (const [app, entry] of targets) {
  const output = `apps/${app}/dist`;
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(`apps/${app}/public`, output, { recursive: true });
  await build({
    entryPoints: [`apps/${app}/src/${entry}.ts`],
    outfile: `${output}/${entry}.js`,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  console.log(`Built ${app} → ${output}`);
}
