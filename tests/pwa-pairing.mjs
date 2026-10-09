import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const fixture = await mkdtemp(join(tmpdir(),'web-relay-pwa-pairing-'));
const launcherPath = join(fixture,'launcher');
await cp(resolve('apps/launcher-extension/dist'),launcherPath,{recursive:true});
const manifest = JSON.parse(await readFile(join(launcherPath,'manifest.json'),'utf8'));
// Headless CI cannot approve Chromium's native permission prompt. Pregrant only
// the fixture host in this disposable copy; production uses optional permissions.
manifest.host_permissions.push('https://page-apps.github.io/*');
await writeFile(join(launcherPath,'manifest.json'),JSON.stringify(manifest));
const launcherId = [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
const sdk = (await build({entryPoints:['packages/sdk/src/index.ts'],bundle:true,write:false,format:'iife',globalName:'SDK'})).outputFiles[0].text;
const pageFixture = `<!doctype html><title>Shared-origin app fixture</title><script>${sdk}</script><script>
window.mount = () => {
 window.app?.dispose();
 const child=location.pathname.startsWith('/quick-log');
 const id=location.pathname.startsWith('/unpaired')?'unpaired':child?'quick-log':'personal-hub';
 window.ready=true;window.calls=window.calls||0;
 window.app=SDK.createLauncher({providerId:id,name:child?'Quick Log':'Personal Hub',context:()=>({ready:window.ready})});
 app.registry.register({id:id+'.toggle-theme',title:'Switch theme',run:()=>({calls:++window.calls})});
 app.registry.register({id:id+'.available',title:'Available action',when:ctx=>ctx.ready,run:()=>({ready:true})});
 app.registry.register({id:id+'.fail',title:'Fail action',run:()=>{throw new SDK.CapabilityError('FIXTURE_ERROR','Fixture error');}});
 if(!child)app.registry.register({id:id+'.open',title:'Open child',run:()=>{setTimeout(()=>location.assign('/quick-log/'),0);return {message:'Opening child'};}});
};mount();</script>`;
let browser;
const live = process.argv.includes('--live-hub');
// Extension-created tabs can bypass Playwright's initial navigation interception.
// Serve the fixture locally so reopened pages use the same SDK and no network account.
const server = live ? undefined : createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end(pageFixture);});
if (server) await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const appOrigin = live ? 'https://page-apps.github.io' : `http://127.0.0.1:${server.address().port}`;
try {
  browser = await chromium.launchPersistentContext(join(fixture,'profile'),{channel:'chromium',headless:true,
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
    args:[`--disable-extensions-except=${launcherPath}`,`--load-extension=${launcherPath}`,'--enable-unsafe-extension-debugging','--no-sandbox','--no-proxy-server']});
  if (live) await browser.route('https://page-apps.github.io/quick-log/**',route=>route.fulfill({contentType:'text/html',body:'<title>Navigation fixture: no account writes</title>'}));
  const hub = await browser.newPage();await hub.goto(appOrigin+'/');
  if(live)await hub.getByRole('button',{name:/Use (light|dark) theme/}).waitFor();
  const settings=await browser.newPage();await settings.goto(`chrome-extension://${launcherId}/options.html`);
  await settings.getByText('Ready to pair an extension.',{exact:true}).waitFor();
  const popup=await browser.newPage();await popup.goto(`chrome-extension://${launcherId}/popup.html`);
  const api=(page,message)=>page.evaluate(message=>chrome.runtime.sendMessage({channel:'web-relay:panel',version:1,...message}),message);
  assert.equal((await api(popup,{type:'pwa-check',url:hub.url()})).error.code,'UNTRUSTED_SENDER');
  assert.equal((await api(settings,{type:'pwa-approve',token:'invented'})).error.code,'APPROVAL_REQUIRED');
  await hub.bringToFront();
  assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.providerId==='personal-hub'),false);
  // Browser access alone never enrolls an app.
  await settings.bringToFront();
  await settings.locator('#pwa-url').fill(hub.url());
  await settings.evaluate(()=>{window.realPermissionRequest=chrome.permissions.request;chrome.permissions.request=async()=>false;});
  await settings.getByRole('button',{name:'Check app connection',exact:true}).click();
  await settings.getByText('Site access was declined. The app was not paired.',{exact:true}).waitFor();
  assert.equal((await api(settings,{type:'pwa-list'})).data.length,0);
  await settings.evaluate(()=>{chrome.permissions.request=window.realPermissionRequest;});
  await settings.getByRole('button',{name:'Check app connection',exact:true}).click();
  await settings.getByRole('heading',{name:'Review app pairing'}).waitFor();
  assert.equal((await api(settings,{type:'pwa-list'})).data.length,0);
  await settings.locator('#pwa-approve').evaluate(button=>button.click());
  assert.equal((await api(settings,{type:'pwa-list'})).data.length,0);
  await settings.getByRole('button',{name:'Approve app pairing',exact:true}).click();
  await settings.getByRole('button',{name:`Disable app ${live?'personal-hub':'Personal Hub'}`,exact:true}).waitFor();
  await hub.bringToFront();
  let list=(await api(popup,{type:'list'})).data;
  const command=list.capabilities.find(c=>c.id==='personal-hub.toggle-theme');assert.ok(command);
  const execute=command=>api(popup,{type:'execute',command,context:list.context});
  assert.equal((await execute(command)).ok,true);
  console.log('PASS actual launcher discovery and invocation'+(live?' on GitHub Pages (deployed hub)':' on local fixture'));
  if(live){
    const manage=list.capabilities.find(c=>c.id==='personal-hub.manage-credentials');
    assert.equal((await execute(manage)).ok,true);
    await hub.getByRole('dialog').waitFor();
    assert.equal((await execute(manage)).error.code,'UNAVAILABLE');
    await hub.getByRole('button',{name:'Cancel',exact:true}).click();
    const navigation=list.capabilities.find(c=>c.id==='personal-hub.open.quick-log');
    const result=await execute(navigation);
    await hub.waitForURL(appOrigin+'/quick-log/');
    console.log('Deployed navigation response:',JSON.stringify(result));
    assert.equal(result.ok,true);
    console.log('PASS deployed hub dialog availability and actual extension navigation; no credentials entered');
  }else{
    const available=list.capabilities.find(c=>c.id==='personal-hub.available');
    await hub.evaluate(()=>window.ready=false);
    assert.equal((await execute(available)).error.code,'UNAVAILABLE');
    assert.equal((await execute(list.capabilities.find(c=>c.id==='personal-hub.fail'))).error.code,'FIXTURE_ERROR');
    await hub.evaluate(()=>app.dispose());
    assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.providerId==='personal-hub'),false);
    await hub.evaluate(()=>mount());
    assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.providerId==='personal-hub'),true);
    await settings.getByRole('button',{name:'Disable app Personal Hub',exact:true}).click();
    await hub.bringToFront();assert.equal((await execute(command)).error.code,'UNAVAILABLE');
    await settings.getByRole('button',{name:'Enable app Personal Hub',exact:true}).click();
    await hub.bringToFront();assert.equal((await execute(command)).ok,true);
    // A second SDK provider on the same page must ignore requests to the hub.
    await hub.evaluate(()=>{
      window.other=SDK.createLauncher({providerId:'other',context:()=>({})});
      other.registry.register({id:'other.action',title:'Other',run:()=>null});
    });
    assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.id==='personal-hub.toggle-theme'),true);
    const child=await browser.newPage();await child.goto(appOrigin+'/quick-log/');
    await settings.locator('#pwa-url').fill(child.url());
    await settings.getByRole('button',{name:'Check app connection',exact:true}).click();
    await settings.getByRole('heading',{name:'Review app pairing'}).waitFor();
    await settings.getByRole('button',{name:'Approve app pairing',exact:true}).click();
    await settings.getByRole('button',{name:'Disable app Quick Log',exact:true}).waitFor();
    await child.bringToFront();
    const childList=(await api(popup,{type:'list'})).data;
    assert.ok(childList.capabilities.some(c=>c.id==='quick-log.toggle-theme'));
    assert.equal(childList.capabilities.some(c=>c.providerId==='personal-hub'),true);
    await hub.bringToFront();list=(await api(popup,{type:'list'})).data;
    await child.goto(appOrigin+'/unpaired/');await child.bringToFront();
    assert.equal((await execute(command)).error.code,'STALE_CONTEXT');
    assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.id==='personal-hub.toggle-theme'),true);
    await hub.bringToFront();
    // Registered apps discover and execute from an unrelated tab, using app-owned state.
    await browser.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Unrelated caller</title>'}));
    const unrelated=await browser.newPage();await unrelated.goto('https://example.com/');await unrelated.bringToFront();
    list=(await api(popup,{type:'list'})).data;
    assert.ok(list.capabilities.some(c=>c.id===command.id));
    const before=await hub.evaluate(()=>window.calls);
    assert.equal((await execute(command)).ok,true);
    assert.equal(await hub.evaluate(()=>window.calls),before+1);
    assert.equal(await unrelated.evaluate(()=>window.calls),undefined);
    assert.equal(list.context.url,unrelated.url());
    const cdp=await browser.browser().newBrowserCDPSession();
    const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'},{exclude:true}]});
    await cdp.send('Extensions.triggerAction',{id:launcherId,targetId:targetInfos.find(target=>target.url===unrelated.url()).targetId});
    const ui=unrelated.locator('web-relay-launcher');
    await ui.getByRole('button',{name:'Switch theme personal-hub',exact:true}).click();
    await ui.locator('#status').filter({hasText:'Action delivered.'}).waitFor();
    assert.equal(await hub.evaluate(()=>window.calls),before+2);
    await ui.locator('#search').press('Escape');
    // Old pairings without a catalog hydrate from their owning tab, without re-pairing.
    const catalogWorker=browser.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${launcherId}/`));
    await catalogWorker.evaluate(async()=>{
      const {pairedPwaProviders:apps}=await chrome.storage.local.get('pairedPwaProviders');
      await chrome.storage.local.set({pairedPwaProviders:apps.map(({commands,...app})=>app)});
    });
    assert.ok((await api(popup,{type:'list'})).data.capabilities.some(c=>c.id===command.id));
    // Do not choose an arbitrary owning tab when duplicate app pages are open.
    const duplicate=await browser.newPage();await duplicate.goto(appOrigin+'/');await unrelated.bringToFront();
    assert.equal((await execute(command)).error.code,'AMBIGUOUS_PAGE');
    await duplicate.close();
    // Closing the page retains metadata; listing never creates tabs. Execution reopens it.
    await hub.close();await unrelated.bringToFront();
    const count=browser.pages().length;
    list=(await api(popup,{type:'list'})).data;
    assert.ok(list.capabilities.some(c=>c.id===command.id));
    assert.equal(browser.pages().length,count);
    assert.ok(list.sources.some(source=>source.name==='Personal Hub' && source.status==='registered'));
    const reopenResult=await execute(command);
    assert.equal(reopenResult.ok,true,JSON.stringify(reopenResult));
    const reopened=browser.pages().find(page=>page.url()===appOrigin+'/');
    assert.ok(reopened);assert.equal(await reopened.evaluate(()=>window.calls),1);
    assert.equal((await api(popup,{type:'list'})).data.context.tabId,list.context.tabId);
    console.log('PASS cross-tab routing, catalog migration, duplicate rejection, closed-app visibility and background reopening');
    const permissionWorker=browser.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${launcherId}/`));
    await permissionWorker.evaluate(()=>{globalThis.realContains=chrome.permissions.contains;chrome.permissions.contains=async()=>false;});
    assert.equal((await api(popup,{type:'list'})).data.capabilities.some(c=>c.providerKind==='pwa'),false);
    await permissionWorker.evaluate(()=>{chrome.permissions.contains=globalThis.realContains;});
    const original = await api(settings,{type:'pwa-check',url:appOrigin+'/unpaired/'});
    assert.equal(original.ok,true);
    const otherSettings=await browser.newPage();await otherSettings.goto(`chrome-extension://${launcherId}/options.html`);
    assert.equal((await api(otherSettings,{type:'pwa-approve',token:original.data.token})).error.code,'APPROVAL_REQUIRED');
    const worker=browser.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${launcherId}/`));
    await worker.evaluate(async()=>{const {pwaPairingProposal:p}=await chrome.storage.session.get('pwaPairingProposal');await chrome.storage.session.set({pwaPairingProposal:{...p,expires:0}});});
    assert.equal((await api(settings,{type:'pwa-approve',token:original.data.token})).error.code,'APPROVAL_REQUIRED');
    await otherSettings.close();
    await settings.getByRole('button',{name:'Remove app Personal Hub',exact:true}).click();
    await unrelated.bringToFront();assert.equal((await execute(command)).error.code,'UNAVAILABLE');
    console.log('PASS explicit approval, path isolation, provider addressing, errors, stale context, disposal/remount and disable/remove');
  }
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(fixture,{recursive:true,force:true});}
