import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const profile = await mkdtemp(join(tmpdir(),'web-relay-overlay-'));
const launcher = resolve('apps/launcher-extension/dist');
const provider = resolve('apps/webapp-extension/dist');
const manifest = JSON.parse(await readFile(join(launcher,'manifest.json'),'utf8'));
const id = [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
let context, server;
try {
  try { await fetch('http://localhost:4173/'); }
  catch {
    server = spawn(process.execPath,['scripts/serve.mjs'],{stdio:['ignore','pipe','inherit']});
    await once(server.stdout,'data');
  }
  context = await chromium.launchPersistentContext(profile,{
    channel:'chromium', headless:true,
    ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),
    args:[`--disable-extensions-except=${launcher},${provider}`,`--load-extension=${launcher},${provider}`,'--enable-unsafe-extension-debugging','--no-sandbox','--no-proxy-server'],
  });
  for (const origin of ['https://github.com/**','https://chatgpt.com/**','https://gemini.google.com/**']) await context.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Navigation fixture</title><p>No account actions occur in this test.</p>'}));
  const page = await context.newPage(); await page.goto('http://localhost:4173/');
  const browserCdp = await context.browser().newBrowserCDPSession();
  async function open(page) {
    await page.bringToFront();
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo'); await cdp.detach();
    const { targetInfos } = await browserCdp.send('Target.getTargets',{filter:[{type:'tab'},{exclude:true}]});
    const tab = targetInfos.find(target => target.url === page.url());
    await browserCdp.send('Extensions.triggerAction',{id,targetId:tab?.targetId || targetInfo.targetId});
    await page.getByRole('dialog',{name:'Web Relay Launcher'}).waitFor();
    return page.locator('web-relay-launcher');
  }
  let ui = await open(page);
  await ui.getByRole('button',{name:'Create note demo-notes'}).evaluate(button=>button.click());
  assert.equal(await page.locator('#notes .note').count(),0);
  await ui.getByRole('button',{name:'Create note demo-notes'}).click();
  await page.locator('#notes').getByRole('button',{name:'Note 1',exact:true}).waitFor();
  await ui.locator('#status').filter({hasText:'Created Note 1'}).waitFor();
  await ui.getByRole('button',{name:'Pin selected note demo-notes'}).click();
  await page.locator('#notes').getByRole('button',{name:'★ Note 1',exact:true}).waitFor();
  await ui.locator('#status').filter({hasText:'Pinned Note 1'}).waitFor();
  await mkdir('test-results',{recursive:true}); await page.screenshot({path:'test-results/injected-launcher.png'});
  await ui.locator('#search').press('Escape'); assert.equal(await page.locator('web-relay-launcher').count(),0);
  console.log('PASS real toolbar action injects launcher; SDK actions, availability, Escape');
  await page.emulateMedia({colorScheme:'dark'});
  ui = await open(page);
  assert.equal(await ui.locator('.panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(21, 33, 28)');
  assert.equal(await ui.getByRole('button',{name:/Prepare question|Share current link/}).count(),0);
  await page.screenshot({path:'test-results/injected-launcher-dark.png'});
  await ui.locator('#search').press('Escape');
  await page.emulateMedia({colorScheme:'light'});
  ui = await open(page);
  assert.equal(await ui.locator('.panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(247, 250, 246)');
  await ui.locator('#search').press('Escape');
  const target = await context.newPage(); await target.goto('https://chatgpt.com/');
  await target.evaluate(()=>document.title='Target chat tab');
  const worker = context.serviceWorkers().find(worker=>worker.url().includes(id));
  const other = await worker.evaluate(()=>chrome.windows.create({url:'https://gemini.google.com/app',focused:false}));
  ui = await open(page);
  assert.equal(await ui.getByRole('button',{name:'Switch to Navigation fixture tabs'}).count(),0);
  await ui.locator('#search').fill('tabs target');
  await ui.getByRole('button',{name:'Switch to Target chat tab tabs'}).waitFor();
  assert.equal(await ui.getByRole('button',{name:/Gemini/}).count(),0);
  await ui.locator('#search').press('Enter');
  await page.locator('web-relay-launcher').waitFor({state:'detached'});
  const active = await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}));
  assert.equal(active[0].url,'https://chatgpt.com/');
  await worker.evaluate(windowId=>chrome.windows.remove(windowId),other.id);
  console.log('PASS system dark/light theme, built-in AI removal, current-window tab search and keyboard switching');
  const github = await context.newPage(); await github.goto('https://github.com/web-relay/web-relay');
  ui = await open(github);
  await ui.getByRole('button',{name:'Open repository issues github'}).click();
  await github.waitForURL('https://github.com/web-relay/web-relay/issues');
  assert.equal(await github.locator('web-relay-launcher').count(),0);
  console.log('PASS activeTab injection on GitHub and cross-extension navigation');
  ui = await open(page);
  await ui.locator('#search').fill('missing command');
  await ui.getByText('No matching commands.').waitFor();
  await ui.locator('.backdrop').click({position:{x:5,y:5}});
  assert.equal(await page.locator('web-relay-launcher').count(),0);
  ui = await open(page);
  await target.bringToFront();
  await page.locator('web-relay-launcher').waitFor({state:'detached'});
  assert.equal(await page.locator('web-relay-launcher').count(),0);
  console.log('PASS no-match search and focus-loss dismissal');
  console.log('Navigation destinations are fixtures; no account actions are performed.');
} finally {
  await context?.close(); server?.kill(); await rm(profile,{recursive:true,force:true});
}
