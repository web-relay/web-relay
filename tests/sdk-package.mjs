import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(command,args,cwd=process.cwd()) {
  const result = spawnSync(command,args,{cwd,stdio:'inherit'});
  if (result.status !== 0) throw new Error(`${command} failed`);
}
await mkdir('artifacts',{recursive:true});
run('pnpm',['--filter','@web-relay/sdk','pack','--pack-destination',resolve('artifacts')]);
const {version} = JSON.parse(await readFile('packages/sdk/package.json','utf8'));
const consumer = await mkdtemp(join(tmpdir(),'web-relay-sdk-consumer-'));
try {
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module',packageManager:'pnpm@12.8.1',dependencies:{'@web-relay/sdk':`file:${resolve(`artifacts/web-relay-sdk-${version}.tgz`)}`}}));
  // The test uses the installed tool; offline mode must not download pnpm itself.
  run('pnpm',['with','current','install','--offline','--ignore-scripts'],consumer);
  await writeFile(join(consumer,'consumer.ts'),`
import {createLauncher, CapabilityError} from '@web-relay/sdk';
import {createExtensionProvider, LAUNCHER_ID} from '@web-relay/sdk/extension';
const pwa = createLauncher({providerId:'other-pwa',context:()=>({selected:true})});
pwa.registry.register({id:'other.save',title:'Save',when:ctx=>ctx.selected,run:()=>({message:'Saved'})});
createExtensionProvider({providerId:'other-extension',launcherId:LAUNCHER_ID,register(registry){
 registry.register({id:'other.open',title:'Open',run:context=>({message:context?.url || 'No context'})});
}});
createExtensionProvider({providerId:'saved-extension',name:'Saved workspaces',launcherId:LAUNCHER_ID,async register(registry){
 await Promise.resolve();
 registry.register({id:'saved.open',title:'Open saved workspace',run:()=>null});
}});
void new CapabilityError('CUSTOM','A returned error');
`);
  run(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','esnext','--moduleResolution','bundler','--target','es2022',join(consumer,'consumer.ts')],consumer);
  await writeFile(join(consumer,'consumer.mjs'),`
import assert from 'node:assert/strict';
import {createLauncher,CapabilityError} from '@web-relay/sdk';
import {createExtensionProvider,LAUNCHER_ID} from '@web-relay/sdk/extension';
const listeners = new Map(); const replies = [];
globalThis.location={origin:'https://other.example'};
globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),postMessage:value=>replies.push(value)};
const app=createLauncher({providerId:'other-pwa',context:()=>({})});
app.registry.register({id:'other.save',title:'Save',run:()=>({message:'Saved'})});
listeners.get('message')({source:window,origin:location.origin,data:{source:'web-relay:extension',message:{channel:'web-relay',version:1,requestId:'one',type:'execute',capabilityId:'other.save'}}});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(replies[0].message.data.message,'Saved');
listeners.get('message')({source:window,origin:location.origin,data:{source:'web-relay:extension',message:{channel:'web-relay',version:1,requestId:'describe-pwa',type:'describe'}}});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(replies[1].message.data.providerId,'other-pwa');
listeners.get('message')({source:window,origin:location.origin,data:{source:'web-relay:extension',message:{channel:'web-relay',version:1,requestId:'wrong-provider',type:'execute',providerId:'another',capabilityId:'other.save'}}});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(replies.length,2);
let finishPending;
app.registry.register({id:'other.pending',title:'Pending',run:()=>new Promise(resolve=>finishPending=resolve)});
listeners.get('message')({source:window,origin:location.origin,data:{source:'web-relay:extension',message:{channel:'web-relay',version:1,requestId:'pending',type:'execute',providerId:'other-pwa',capabilityId:'other.pending'}}});
await new Promise(resolve=>setTimeout(resolve,0));
app.dispose();assert.equal(listeners.has('message'),false);
finishPending({completed:true});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(replies[2].message.data.completed,true);
let external;
globalThis.chrome={runtime:{onMessageExternal:{addListener:fn=>external=fn,removeListener:()=>{}}}};
const provider=createExtensionProvider({providerId:'other-extension',launcherId:LAUNCHER_ID,register(registry){registry.register({id:'other.open',title:'Open',run:()=>({message:'Opened'})});registry.register({id:'other.fail',title:'Fail',run:()=>{throw new CapabilityError('CUSTOM','Actionable error');}});}});
const request={channel:'web-relay',version:1,requestId:'two',type:'discover'};
assert.equal(external(request,{id:'untrusted'},()=>assert.fail('Untrusted sender replied')),undefined);
const metadata=await new Promise(resolve=>external(request,{id:LAUNCHER_ID},resolve));
assert.equal(metadata.data[0].providerId,'other-extension');
const result=await new Promise(resolve=>external({...request,type:'execute',capabilityId:'other.open'},{id:LAUNCHER_ID},resolve));
assert.equal(result.data.message,'Opened');
const failure=await new Promise(resolve=>external({...request,type:'execute',capabilityId:'other.fail'},{id:LAUNCHER_ID},resolve));
assert.equal(failure.error.code,'CUSTOM'); provider.dispose();
// A deferred configuration load must not delay listener installation or produce partial lists.
let release; let loads=0; let calls=0; let failLoad=false;
let active={id:4,url:'https://other.example/'};
chrome.tabs={query:async()=>[active]};
let saved=[{id:'one',name:'Work'}];
const dynamic=createExtensionProvider({providerId:'saved',name:'Saved workspaces',launcherId:LAUNCHER_ID,async register(registry){
 loads++;
 await new Promise(resolve=>release=resolve);
 if(failLoad) throw new CapabilityError('CONFIG_FAILED','Could not read saved workspaces.');
 for(const workspace of saved) registry.register({id:'saved.'+workspace.id,title:workspace.name,run:()=>{calls++;return workspace.id;}});
}});
assert.equal(typeof external,'function');
assert.equal(external(request,{id:'untrusted'},()=>assert.fail('Untrusted sender replied')),undefined);
assert.equal(loads,0);
const invoke=message=>new Promise(resolve=>assert.equal(external({...request,...message},{id:LAUNCHER_ID},resolve),true));
const described=await invoke({type:'describe'});
assert.deepEqual(described.data,{providerId:'saved',name:'Saved workspaces',protocolVersion:1});
assert.equal(loads,0);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let replied=false;
const discovery=invoke({type:'discover'}).then(value=>{replied=true;return value;});
await tick(); assert.equal(loads,1); assert.equal(replied,false);
release(); assert.equal((await discovery).data[0].title,'Work');
saved=[];
const removed=invoke({type:'execute',capabilityId:'saved.one'});
await tick(); release(); assert.equal((await removed).error.code,'NOT_FOUND'); assert.equal(calls,0);
saved=[{id:'two',name:'Personal'}];
const execution=invoke({type:'execute',capabilityId:'saved.two'});
await tick(); release(); assert.equal((await execution).data,'two'); assert.equal(calls,1);
failLoad=true;
const rejected=invoke({type:'discover'});
await tick(); release(); assert.equal((await rejected).error.code,'CONFIG_FAILED');
failLoad=false;
const stale=invoke({type:'execute',capabilityId:'saved.two',context:{tabId:4,url:active.url}});
await tick(); active={id:4,url:'https://other.example/changed'}; release();
assert.equal((await stale).error.code,'STALE_CONTEXT'); assert.equal(calls,1);
const alreadyStale=await invoke({type:'discover',context:{tabId:4,url:'https://other.example/'}});
assert.equal(alreadyStale.error.code,'STALE_CONTEXT'); assert.equal(loads,5);
dynamic.dispose();
console.log('PASS async registration: immediate listener, awaited discovery/execution, fresh saved state, load failures, stale context');
console.log('PASS isolated packed SDK: imports, declarations, PWA bridge, extension discovery/execution, sender rejection');
`);
  run(process.execPath,['consumer.mjs'],consumer);
} finally {await rm(consumer,{recursive:true,force:true});}
