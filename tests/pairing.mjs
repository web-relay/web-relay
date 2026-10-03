import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';

const fixture = await mkdtemp(join(tmpdir(),'web-relay-pairing-'));
const launcherPath = resolve('apps/launcher-extension/dist');
const launcherManifest = JSON.parse(await readFile(join(launcherPath,'manifest.json'),'utf8'));
const extensionId = key => [...createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32)]
  .map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
const launcherId = extensionId(launcherManifest.key);
const paths = [], ids = [];
let browser;
try {
  for (const legacy of [false,true]) {
    const path = join(fixture,legacy?'legacy':'modern'); paths.push(path);
    const key = generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');
    ids.push(extensionId(key));
    await mkdir(path);
    await writeFile(join(path,'manifest.json'),JSON.stringify({manifest_version:3,name:'Pairing fixture',version:'0.0.1',key,
      permissions:['storage','tabs'],background:{service_worker:'background.js',type:'module'},externally_connectable:{ids:[launcherId]}}));
    const contents = legacy ? `
      chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
        if(sender.id!==${JSON.stringify(launcherId)} || message.version!==1 || message.type==='describe') return;
        respond({channel:'web-relay',version:globalThis.invalidVersion?99:1,requestId:message.requestId,type:'result',ok:true,data:message.type==='discover'?
          [{id:'legacy.open',title:'Legacy action',providerId:'legacy',providerKind:'extension'}]:{message:'Legacy delivered'}});
      });
    ` : `
      import {createExtensionProvider} from ${JSON.stringify(resolve('packages/sdk/dist/extension.js'))};
      globalThis.options={providerId:'saved-workspaces',name:'Saved workspaces',launcherId:${JSON.stringify(launcherId)},async register(registry){
        const {ready}=await chrome.storage.local.get('ready');
        if(ready) registry.register({id:'saved.open',title:'Open saved workspace',run:context=>({message:'Workspace delivered',shared:!!context})});
      }};
      createExtensionProvider(globalThis.options);
    `;
    await build({stdin:{contents,resolveDir:process.cwd()},outfile:join(path,'background.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
  }
  const launch = async () => {
    const context = await chromium.launchPersistentContext(join(fixture,'profile'),{channel:'chromium',headless:true,
      ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
      args:[`--disable-extensions-except=${launcherPath},${paths.join(',')}`,`--load-extension=${launcherPath},${paths.join(',')}`,'--no-sandbox','--no-proxy-server']});
    await context.route('https://example.org/**',route=>route.fulfill({contentType:'text/html',body:'<title>Source fixture</title>'}));
    return context;
  };
  const worker = async id => browser.serviceWorkers().find(worker=>worker.url().startsWith(`chrome-extension://${id}/`))
    ?? await browser.waitForEvent('serviceworker',{predicate:worker=>worker.url().startsWith(`chrome-extension://${id}/`)});
  browser = await launch();
  const provider = await worker(ids[0]);
  const entry = await browser.newPage();
  await entry.goto(`chrome-extension://${launcherId}/popup.html`);
  await entry.getByText('Capability sources',{exact:true}).click();
  const opened = browser.waitForEvent('page');
  await entry.getByRole('button',{name:'Manage extension providers'}).click();
  let settings = await opened;
  await settings.waitForURL(`chrome-extension://${launcherId}/options.html`);
  await settings.getByText('Ready to pair an extension.',{exact:true}).waitFor();
  const api = (page,message) => page.evaluate(message=>chrome.runtime.sendMessage({channel:'web-relay:panel',version:1,...message}),message);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${launcherId}/popup.html`);
  const denied = await api(popup,{type:'pairing-check',extensionId:ids[0]});
  assert.equal(denied.error.code,'UNTRUSTED_SENDER');
  assert.equal((await api(settings,{type:'pairing-approve',token:'invented',shareTabContext:true})).error.code,'APPROVAL_REQUIRED');
  assert.equal((await api(settings,{type:'pairing-check',extensionId:'bad'})).error.code,'INVALID_PROVIDER');
  const before = await api(popup,{type:'list'});
  assert.equal(before.data.capabilities.some(command=>command.providerId==='saved-workspaces'),false);
  await settings.locator('#extension-id').fill(ids[0]);
  await settings.getByRole('button',{name:'Check connection',exact:true}).click();
  await settings.getByRole('heading',{name:'Review pairing'}).waitFor();
  assert.equal(await settings.locator('#review-name').textContent(),'Saved workspaces');
  assert.equal((await api(settings,{type:'pairing-list'})).data.providers.length,0);
  await settings.locator('#approve').evaluate(button=>button.click());
  assert.equal((await api(settings,{type:'pairing-list'})).data.providers.length,0);
  await settings.getByRole('button',{name:'Approve pairing'}).click();
  await settings.getByRole('button',{name:'Disable Saved workspaces'}).waitFor();
  assert.equal((await api(settings,{type:'pairing-list'})).data.providers[0].shareTabContext,false);
  console.log('PASS settings-only approval, no silent enrollment, empty provider identity, synthetic approval rejected');

  await provider.evaluate(()=>chrome.storage.local.set({ready:true}));
  const source = await browser.newPage(); await source.goto('https://example.org/private?token=fixture');
  await source.bringToFront();
  const list = await api(popup,{type:'list'});
  const command = list.data.capabilities.find(command=>command.id==='saved.open'); assert.ok(command);
  const invoke = ()=>api(popup,{type:'execute',command,context:list.data.context});
  const result = await invoke(); assert.equal(result.ok,true); assert.equal(result.data.shared,false);
  await settings.getByRole('button',{name:'Disable Saved workspaces'}).click();
  await settings.getByRole('button',{name:'Enable Saved workspaces'}).waitFor();
  await source.bringToFront();
  assert.equal((await invoke()).error.code,'UNAVAILABLE');
  await settings.getByRole('button',{name:'Enable Saved workspaces'}).click();
  await settings.getByRole('button',{name:'Disable Saved workspaces'}).waitFor();
  await source.bringToFront();
  assert.equal((await invoke()).ok,true);
  await settings.getByRole('button',{name:'Remove Saved workspaces'}).click();
  await settings.getByText('No additional providers paired.',{exact:true}).waitFor();
  await source.bringToFront();
  assert.equal((await invoke()).error.code,'UNAVAILABLE');
  console.log('PASS real launcher discovery/invocation, no URL leakage by default, disable/remove stale-command rejection');

  await settings.bringToFront();
  const otherSettings = await browser.newPage();
  await otherSettings.goto(`chrome-extension://${launcherId}/options.html`);
  const owned = await api(settings,{type:'pairing-check',extensionId:ids[0]});
  assert.equal((await api(otherSettings,{type:'pairing-approve',token:owned.data.token,shareTabContext:false})).error.code,'APPROVAL_REQUIRED');
  await otherSettings.close();
  const launcher = await worker(launcherId);
  await launcher.evaluate(async()=>{
    const {extensionPairingProposal:proposal}=await chrome.storage.session.get('extensionPairingProposal');
    await chrome.storage.session.set({extensionPairingProposal:{...proposal,expires:0}});
  });
  assert.equal((await api(settings,{type:'pairing-approve',token:owned.data.token,shareTabContext:false})).error.code,'APPROVAL_REQUIRED');
  const changed = await api(settings,{type:'pairing-check',extensionId:ids[0]});
  await provider.evaluate(()=>globalThis.options.name='Changed name');
  assert.equal((await api(settings,{type:'pairing-approve',token:changed.data.token,shareTabContext:false})).error.code,'IDENTITY_CHANGED');
  await provider.evaluate(()=>{globalThis.options.name='Saved workspaces';globalThis.options.providerId='browser';});
  assert.equal((await api(settings,{type:'pairing-check',extensionId:ids[0]})).error.code,'ALREADY_PAIRED');
  await provider.evaluate(()=>globalThis.options.providerId='saved-workspaces');
  await settings.locator('#extension-id').fill(ids[0]);
  await settings.getByRole('button',{name:'Check connection',exact:true}).click();
  await settings.getByRole('heading',{name:'Review pairing'}).waitFor();
  await settings.locator('#share-context').check();
  await settings.getByRole('button',{name:'Approve pairing'}).click();
  await settings.getByRole('button',{name:'Disable Saved workspaces'}).waitFor();
  await source.bringToFront();
  assert.equal((await invoke()).data.shared,true);
  assert.equal((await api(settings,{type:'pairing-check',extensionId:ids[0]})).error.code,'ALREADY_PAIRED');
  const oldWorker=await worker(ids[1]);
  await oldWorker.evaluate(()=>globalThis.invalidVersion=true);
  assert.equal((await api(settings,{type:'pairing-check',extensionId:ids[1]})).error.code,'INVALID_RESPONSE');
  await oldWorker.evaluate(()=>globalThis.invalidVersion=false);
  const legacy = await api(settings,{type:'pairing-check',extensionId:ids[1]});
  assert.equal(legacy.ok,true);assert.equal(legacy.data.providerId,'legacy');
  const approvals=await Promise.all([
    api(settings,{type:'pairing-approve',token:legacy.data.token,shareTabContext:false}),
    api(settings,{type:'pairing-approve',token:legacy.data.token,shareTabContext:false}),
  ]);
  assert.equal(approvals.filter(result=>result.ok).length,1);
  assert.equal(approvals.filter(result=>result.error?.code==='APPROVAL_REQUIRED').length,1);
  console.log('PASS identity-change/duplicate/reserved-ID rejection, explicit URL sharing, legacy discovery pairing');

  await browser.close(); browser=await launch();
  settings=await browser.newPage();await settings.goto(`chrome-extension://${launcherId}/options.html`);
  await settings.getByRole('button',{name:'Disable Saved workspaces'}).waitFor();
  await settings.getByRole('button',{name:'Disable legacy'}).waitFor();
  const persisted = (await api(settings,{type:'pairing-list'})).data.providers;
  assert.equal(persisted.length,2);assert.equal(persisted[0].shareTabContext,true);
  console.log('PASS approved pairings persist across browser and worker restart');
} finally {await browser?.close();await rm(fixture,{recursive:true,force:true});}
