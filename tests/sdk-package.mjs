import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function run(command,args,cwd=process.cwd()) {
  const result = spawnSync(command,args,{cwd,stdio:'inherit'});
  if (result.status !== 0) throw new Error(`${command} failed`);
}
await mkdir('artifacts',{recursive:true});
run('pnpm',['--filter','@web-relay/sdk','pack','--pack-destination',resolve('artifacts')]);
const consumer = await mkdtemp(join(tmpdir(),'web-relay-sdk-consumer-'));
try {
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module',packageManager:'pnpm@12.8.1',dependencies:{'@web-relay/sdk':`file:${resolve('artifacts/web-relay-sdk-0.1.0.tgz')}`}}));
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
assert.equal(replies[0].message.data.message,'Saved'); app.dispose();
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
console.log('PASS isolated packed SDK: imports, declarations, PWA bridge, extension discovery/execution, sender rejection');
`);
  run(process.execPath,['consumer.mjs'],consumer);
} finally {await rm(consumer,{recursive:true,force:true});}
