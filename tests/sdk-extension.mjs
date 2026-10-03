import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// A temporary storage-backed provider replaces the paired GitHub fixture only in
// this browser profile. No launcher allowlist or installed extension is changed.
const fixture = await mkdtemp(join(tmpdir(), 'web-relay-async-sdk-'));
const launcherPath = resolve('apps/launcher-extension/dist');
const providerPath = join(fixture, 'provider');
const extensionId = manifest => [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0,32)]
  .map(c => String.fromCharCode(97 + parseInt(c,16))).join('');
const launcherManifest = JSON.parse(await readFile(join(launcherPath, 'manifest.json'), 'utf8'));
const manifest = JSON.parse(await readFile('apps/webapp-extension/public/manifest.json', 'utf8'));
const launcherId = extensionId(launcherManifest);
const providerId = extensionId(manifest);
let browser;
try {
  await mkdir(providerPath);
  await writeFile(join(providerPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Async registration fixture', version: '0.0.1', key: manifest.key,
    permissions: ['storage', 'tabs'], background: { service_worker: 'background.js', type: 'module' },
    externally_connectable: { ids: [launcherId] },
  }));
  await build({
    stdin: { contents: `
      import {createExtensionProvider, CapabilityError} from ${JSON.stringify(resolve('packages/sdk/dist/extension.js'))};
      globalThis.loads = 0;
      globalThis.calls = 0;
      globalThis.gates = [];
      createExtensionProvider({providerId:'github',launcherId:${JSON.stringify(launcherId)},async register(registry){
        globalThis.loads++;
        const {hold,fail,workspaces=[]} = await chrome.storage.local.get(['hold','fail','workspaces']);
        if (hold) await new Promise(resolve => globalThis.gates.push(resolve));
        if (fail) throw new CapabilityError('CONFIG_FAILED','Could not read saved workspaces.');
        for (const workspace of workspaces.filter(item => item.enabled)) {
          registry.register({id:'github.workspace-'+workspace.id,title:'Open '+workspace.name,run:()=>{
            globalThis.calls++;
            return {message:'Opened '+workspace.name};
          }});
        }
      }});
    `, resolveDir: process.cwd(), sourcefile: 'async-provider-fixture.js' },
    outfile: join(providerPath, 'background.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  });
  browser = await chromium.launchPersistentContext(join(fixture, 'profile'), {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    args: [`--disable-extensions-except=${launcherPath},${providerPath}`, `--load-extension=${launcherPath},${providerPath}`, '--no-sandbox', '--no-proxy-server'],
  });
  const getWorker = async id => browser.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${id}/`))
    ?? await browser.waitForEvent('serviceworker', {predicate: worker => worker.url().startsWith(`chrome-extension://${id}/`)});
  const launcher = await getWorker(launcherId);
  const provider = await getWorker(providerId);
  const configure = config => provider.evaluate(config => chrome.storage.local.set(config), config);
  const send = message => launcher.evaluate(async ({providerId,message}) => chrome.runtime.sendMessage(providerId, {
    channel:'web-relay',version:1,requestId:crypto.randomUUID(),...message,
  }), {providerId,message});
  const waitGates = async count => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await provider.evaluate(() => globalThis.gates.length) === count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Registration did not reach the configuration gate');
  };
  const release = () => provider.evaluate(() => globalThis.gates.splice(0).forEach(resolve => resolve()));
  await configure({workspaces:[{id:'work',name:'Work',enabled:true},{id:'hidden',name:'Hidden',enabled:false}]});
  assert.deepEqual((await send({type:'discover'})).data.map(command=>command.id), ['github.workspace-work']);
  assert.equal((await send({type:'execute',capabilityId:'github.workspace-work'})).data.message, 'Opened Work');
  console.log('PASS Chromium SDK: storage-backed discovery and invocation');

  // Verify the real launcher also consumes the asynchronous descriptors.
  await browser.route('https://github.com/**', route => route.fulfill({contentType:'text/html',body:'<title>SDK fixture</title>'}));
  const page = await browser.newPage();
  await page.goto('https://github.com/web-relay/web-relay');
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${launcherId}/popup.html`);
  await page.bringToFront();
  const snapshot = await popup.evaluate(() => chrome.runtime.sendMessage({channel:'web-relay:panel',version:1,type:'list'}));
  assert.equal(snapshot.ok, true);
  const command = snapshot.data.capabilities.find(command => command.id === 'github.workspace-work');
  assert.ok(command);
  const result = await popup.evaluate(message => chrome.runtime.sendMessage(message), {
    channel:'web-relay:panel',version:1,type:'execute',command,context:snapshot.data.context,
  });
  assert.equal(result.data.message,'Opened Work');
  await popup.close();
  await page.bringToFront();
  await configure({workspaces:[]});
  assert.equal((await send({type:'execute',capabilityId:command.id})).error.code,'NOT_FOUND');
  await configure({workspaces:[{id:'work',name:'Work',enabled:false}]});
  assert.equal((await send({type:'execute',capabilityId:command.id})).error.code,'NOT_FOUND');
  assert.equal(await provider.evaluate(()=>globalThis.calls),2);
  console.log('PASS real launcher routing; deleted/disabled saved commands cannot execute');

  await configure({fail:true});
  assert.equal((await send({type:'discover'})).error.code,'CONFIG_FAILED');
  assert.equal((await send({type:'execute',capabilityId:command.id})).error.code,'CONFIG_FAILED');
  await configure({fail:false,hold:true,workspaces:[{id:'work',name:'Work',enabled:true}]});
  const context = await launcher.evaluate(async()=>{
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    return {tabId:tab.id,url:tab.url};
  });
  const pending = send({type:'execute',capabilityId:command.id,context});
  await waitGates(1);
  await page.goto('https://github.com/web-relay/web-relay/issues');
  await release();
  assert.equal((await pending).error.code,'STALE_CONTEXT');
  assert.equal(await provider.evaluate(()=>globalThis.calls),2);
  console.log('PASS registration failures and navigation during async loading reject execution');

  const first = send({type:'discover'});
  await waitGates(1);
  await configure({workspaces:[{id:'personal',name:'Personal',enabled:true}]});
  const second = send({type:'discover'});
  await waitGates(2);
  await release();
  assert.deepEqual((await first).data.map(command=>command.id),['github.workspace-work']);
  assert.deepEqual((await second).data.map(command=>command.id),['github.workspace-personal']);
  console.log('PASS overlapping requests retain separate registries');
} finally {
  await browser?.close();
  await rm(fixture, {recursive:true,force:true});
}
