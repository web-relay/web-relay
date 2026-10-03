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
  ui = await open(page);
  await ui.getByRole('button',{name:'Prepare question for a new ChatGPT chat browser'}).click();
  await ui.getByRole('textbox',{name:'Question',exact:true}).fill('How do local browser capabilities work?');
  const chatPage = context.waitForEvent('page');
  await ui.getByRole('button',{name:'Copy question & open ChatGPT'}).click();
  const chat = await chatPage; await chat.waitForURL('https://chatgpt.com/');
  assert.equal(await page.locator('web-relay-launcher').count(),0);
  await context.grantPermissions(['clipboard-read'],{origin:'http://localhost:4173'});
  await page.bringToFront();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'How do local browser capabilities work?');
  console.log('PASS question input, real clipboard handoff, ChatGPT navigation, blur dismissal');
  ui = await open(page);
  const geminiPage = context.waitForEvent('page');
  await ui.getByRole('button',{name:'Share current link with Gemini browser'}).click();
  const gemini = await geminiPage; await gemini.waitForURL('https://gemini.google.com/app');
  await page.bringToFront();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'http://localhost:4173/');
  console.log('PASS Gemini current-link handoff');
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
  await chat.bringToFront();
  await page.locator('web-relay-launcher').waitFor({state:'detached'});
  assert.equal(await page.locator('web-relay-launcher').count(),0);
  console.log('PASS no-match search and focus-loss dismissal');
  console.log('AI destination pages are fixtures. Clipboard and navigation are real; no prompts are submitted.');
} finally {
  await context?.close(); server?.kill(); await rm(profile,{recursive:true,force:true});
}
