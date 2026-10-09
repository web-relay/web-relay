import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const profile = await mkdtemp(join(tmpdir(),'web-relay-webmcp-'));
const launcher = resolve('apps/launcher-extension/dist');
const provider = resolve('apps/webapp-extension/dist');
const manifest = JSON.parse(await readFile(join(launcher,'manifest.json'),'utf8'));
const id = [...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
let context;
try {
  context = await chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,
    ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),
    args:[`--disable-extensions-except=${launcher},${provider}`,`--load-extension=${launcher},${provider}`,'--enable-unsafe-extension-debugging','--no-sandbox','--no-proxy-server','--enable-blink-features=WebMCP,WebMCPTesting'],
  });
  await context.route('http://localhost:4173/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>WebMCP fixture</title><p id="output">No calls</p>'}));
  const page = await context.newPage(); await page.goto('http://localhost:4173/webmcp');
  const cdp = await context.browser().newBrowserCDPSession();
  async function open() {
    await page.bringToFront();
    const {targetInfos} = await cdp.send('Target.getTargets',{filter:[{type:'tab'},{exclude:true}]});
    await cdp.send('Extensions.triggerAction',{id,targetId:targetInfos.find(target=>target.url===page.url()).targetId});
    const ui = page.locator('web-relay-launcher');
    await ui.getByRole('dialog',{name:'Web Relay Launcher'}).waitFor();
    await ui.locator('#status').filter({hasText:/commands available/}).waitFor();
    return ui;
  }
  async function register() {
    return page.evaluate(async()=>{
      window.calls=0;
      const api=document.modelContext ?? navigator.modelContext;
      if(!api) throw new Error('Native WebMCP preview API unavailable in this Chromium.');
      window.toolController=new AbortController();
      await api.registerTool({name:'echo_value',description:'Echo a value',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']},execute:({value})=>{
        window.calls++;document.querySelector('#output').textContent=value;
        return JSON.stringify({clipboard:'must not copy',openUrl:'https://chatgpt.com/',message:value});
      }},{signal:window.toolController.signal});
      await api.registerTool({name:'empty_tool',description:'No arguments',inputSchema:{type:'object',properties:{}},execute:()=>{window.calls++;return 'Empty done';}});
      await api.registerTool({name:'failing_tool',description:'Throws an error',inputSchema:{type:'object',properties:{}},execute:()=>{throw new Error('Fixture execution failed');}});
    });
  }
  context.setDefaultTimeout(10000);
  console.log('Native browser',context.browser().version());
  await register();
  console.log('Registered native tools');
  let ui=await open();
  assert.equal(await ui.getByRole('button',{name:'echo_value webmcp'}).count(),0);
  await ui.getByText('Capability sources',{exact:true}).click();
  await ui.locator('#webmcp-enabled').check();
  await ui.getByRole('button',{name:'echo_value webmcp'}).click();
  assert.match(await ui.locator('#tool-schema').textContent(),/"required"/);
  assert.ok((await ui.locator('#tool-schema').textContent()).startsWith('{'));
  await ui.locator('#question').fill('invalid');
  await ui.locator('#question-send').click();
  await ui.locator('#status').filter({hasText:'Enter valid JSON'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls),0);
  await ui.locator('#question').fill('{"value":"Native success"}');
  await ui.locator('#question-send').click();
  await page.locator('#output').filter({hasText:'Native success'}).waitFor();
  await ui.locator('#status').filter({hasText:'must not copy'}).waitFor();
  assert.equal(page.url(),'http://localhost:4173/webmcp');
  assert.equal(await page.evaluate(()=>window.calls),1);
  console.log('PASS opt-in native discovery, JSON validation, invocation, page result isolation');
  await ui.getByRole('button',{name:'empty_tool webmcp'}).click();
  await ui.locator('#question-send').click();
  await ui.locator('#status').filter({hasText:'Empty done'}).waitFor();
  await ui.getByRole('button',{name:'failing_tool webmcp'}).click();
  await ui.locator('#question-send').click();
  await page.waitForFunction(()=>!document.querySelector('web-relay-launcher').shadowRoot.querySelector('#status').textContent.startsWith('Running'));
  assert.match(await ui.locator('#status').textContent(),/failed|error/i);
  await ui.locator('#question-cancel').click();
  await ui.getByRole('button',{name:'echo_value webmcp'}).click();
  await page.evaluate(()=>window.toolController.abort());
  await ui.locator('#question').fill('{"value":"must not run"}');
  await ui.locator('#question-send').click();
  await ui.locator('#status').filter({hasText:'no longer available'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls),2);
  await ui.locator('#question-cancel').click();
  await ui.locator('#webmcp-enabled').uncheck();
  await ui.locator('#sources').getByText('WebMCP · disabled').waitFor();
  assert.equal(await ui.getByRole('button',{name:'empty_tool webmcp'}).count(),0);
  console.log('PASS empty inputs, native tool errors, removed tools, disable');
  await ui.locator('#search').press('Escape');
  await page.evaluate(()=>{Object.defineProperty(document,'modelContext',{value:undefined});});
  ui=await open();await ui.getByText('Capability sources',{exact:true}).click();await ui.locator('#webmcp-enabled').check();
  await ui.locator('#sources').getByText('WebMCP · unavailable').waitFor();
  await ui.getByRole('button',{name:'Open new tab browser'}).waitFor();
  console.log('PASS unavailable preview API preserves browser commands');
  await ui.locator('#search').press('Escape');
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  await page.reload();await register();await page.bringToFront();
  async function api(message) {
    return popup.evaluate(message=>chrome.runtime.sendMessage({channel:'web-relay:panel',version:1,...message}),message);
  }
  const snapshot=await api({type:'list'});
  assert.equal(snapshot.ok,true);
  const saved=snapshot.data.capabilities.find(command=>command.id==='echo_value' && command.providerKind==='webmcp');
  assert.ok(saved);
  await page.reload();await register();
  const stale=await api({type:'execute',command:saved,context:snapshot.data.context,input:'{"value":"stale write"}'});
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_CONTEXT');
  assert.equal(await page.evaluate(()=>window.calls),0);
  const fresh=await api({type:'list'});
  const selected=fresh.data.capabilities.find(command=>command.id==='echo_value' && command.providerKind==='webmcp');
  await page.evaluate(async()=>{
    window.toolController.abort();
    await document.modelContext.registerTool({name:'echo_value',description:'Changed inputs',inputSchema:{type:'object',properties:{changed:{type:'boolean'}}},execute:()=>{window.calls++;return 'must not run';}});
  });
  const changed=await api({type:'execute',command:selected,context:fresh.data.context,input:'{}'});
  assert.equal(changed.ok,false);assert.equal(changed.error.code,'STALE_CONTEXT');
  assert.equal(await page.evaluate(()=>window.calls),0);
  console.log('PASS same-URL reload and schema changes reject stale selections without execution');
  if(process.argv.includes('--live-site')) {
    await page.goto('https://cmwen.dev/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(async()=>document.modelContext && (await document.modelContext.getTools()).some(tool=>tool.name==='search_site'));
    ui=await open();
    const live = await api({type:'list'});
    const search = live.data?.capabilities.find(command=>command.id==='search_site' && command.providerKind==='webmcp');
    assert.ok(search,JSON.stringify(live));
    await ui.getByRole('button',{name:`${search.title} webmcp`,exact:true}).click();
    assert.match(await ui.locator('#tool-schema').textContent(),/"query"/);
    assert.ok((await ui.locator('#tool-schema').textContent()).startsWith('{'));
    console.log('PASS deployed cmwen.dev native tool discovery and schema review; no site tool invoked');
  }

} finally {await context?.close();await rm(profile,{recursive:true,force:true});}
