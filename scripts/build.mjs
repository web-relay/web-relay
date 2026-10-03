import { build } from 'esbuild';
import './build-sdk.mjs';
import { cp, mkdir, rm } from 'node:fs/promises';
const targets = [
  ['demo-pwa', ['main']],
  ['launcher-extension', ['background', 'popup', 'content', 'overlay']],
  ['webapp-extension', ['background']],
];
for (const [app, entries] of targets) {
  const output = `apps/${app}/dist`;
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(`apps/${app}/public`, output, { recursive: true });
  for (const entry of entries) await build({
    entryPoints: [`apps/${app}/src/${entry}.ts`], outfile: `${output}/${entry}.js`,
    loader: { '.html': 'text', '.css': 'text' },
    bundle: true, format: ['content','overlay'].includes(entry) ? 'iife' : 'esm', platform: 'browser', target: 'es2022',
  });
  console.log(`Built ${app} → ${output}`);
}
