import { matchesPwa, pwaScope, savedPwas, hostPattern } from '../apps/launcher-extension/src/pwa-pairing';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityError, Registry } from '../packages/core/src/index';
import { bounded, descriptors, failure, isPwaOrigin, isRequest, request, success, unwrap } from '../packages/protocol/src/index';
import { savedProviders } from '../apps/launcher-extension/src/pairing';
import { githubRegistry, repositoryUrl } from '../apps/webapp-extension/src/github';

test('availability is rechecked at execution; unregister removes a command', async () => {
  let selected = true;
  let calls = 0;
  const registry = new Registry('demo-notes', 'pwa', () => ({ selected }));
  const remove = registry.register({ id: 'notes.pin', title: 'Pin note', when: context => context.selected, run: () => { calls++; return null; } });
  assert.equal(registry.list().length, 1);
  selected = false;
  assert.equal(registry.list().length, 0);
  await assert.rejects(registry.execute('notes.pin'), { code: 'UNAVAILABLE' });
  assert.equal(calls, 0);
  selected = true;
  await registry.execute('notes.pin'); assert.equal(calls, 1);
  remove(); await assert.rejects(registry.execute('notes.pin'), { code: 'NOT_FOUND' });
});
test('duplicates fail and stale unregister cannot remove a replacement', () => {
  const registry = new Registry('demo', 'pwa', () => ({}));
  const command = { id: 'notes.create', title: 'Create note', run: () => null };
  const remove = registry.register(command);
  assert.throws(() => registry.register(command), { code: 'DUPLICATE_ID' });
  command.title = 'Changed outside the registry';
  assert.equal(registry.list()[0]!.title, 'Create note');
  remove(); registry.register(command); remove(); assert.equal(registry.list().length, 1);
});
test('wire contract rejects wrong versions, malformed requests, and mismatched results', () => {
  const req = request('execute', 'notes.create');
  assert.equal(isRequest(req), true);
  assert.equal(isRequest({ ...req, version: 2 }), false);
  assert.equal(isRequest({ ...req, capabilityId: undefined }), false);
  assert.equal(isRequest({ ...req, context: { tabId: -1, url: 'test' } }), false);
  assert.equal(unwrap(success(req, { count: 1 }), req)?.count, 1);
  assert.throws(() => unwrap(success(req, null), request('discover')), { code: 'INVALID_RESPONSE' });
  assert.throws(() => unwrap(failure(req, new CapabilityError('UNAVAILABLE','Gone')), req), { code: 'UNAVAILABLE' });
  assert.throws(() => success(req, undefined as never), { code: 'INVALID_RESULT' });
});
test('provider identity and duplicate metadata are validated', () => {
  const value = [{ id: 'notes.create', title: 'Create', providerId: 'notes', providerKind: 'pwa' }];
  assert.equal(descriptors(value,'notes','pwa').length, 1);
  assert.throws(() => descriptors(value,'other','pwa'), { code: 'INVALID_RESPONSE' });
  assert.throws(() => descriptors([...value,...value],'notes','pwa'), { code: 'INVALID_RESPONSE' });
});
test('trust is limited to exact local development origins', () => {
  assert.equal(isPwaOrigin('http://localhost:4173/notes'), true);
  for (const url of ['http://localhost:4174/','https://localhost:4173/','http://localhost.evil:4173/','https://example.com/','garbage']) assert.equal(isPwaOrigin(url), false);
});
test('transport requests time out and preserve real failures', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 10), { code: 'TIMEOUT' });
  await assert.rejects(bounded(Promise.reject(new Error('Disconnected'))), { message: 'Disconnected' });
  assert.equal(await bounded(Promise.resolve(42)), 42);
});
test('GitHub capabilities are contextual and navigate only to known GitHub paths', async () => {
  assert.equal(repositoryUrl('https://github.com/web-relay/web-relay/tree/main'), 'https://github.com/web-relay/web-relay');
  for (const url of ['https://github.com/settings/profile','https://github.com/orgs/web-relay','https://github.com/','https://github.com.evil/owner/repo','http://github.com/owner/repo']) assert.equal(repositoryUrl(url), undefined);
  let context: { tabId: number; url: string } | undefined;
  const calls: unknown[] = [];
  const registry = githubRegistry(() => context, async (...args) => { calls.push(args); });
  assert.deepEqual(registry.list().map(item => item.id), ['github.open-project']);
  context = { tabId: 4, url: 'https://github.com/web-relay/web-relay/tree/main' };
  assert.equal(registry.list().length, 4);
  await registry.execute('github.repo-issues');
  assert.deepEqual(calls, [['https://github.com/web-relay/web-relay/issues',4]]);
  context = undefined;
  await assert.rejects(registry.execute('github.repo-issues'), { code: 'UNAVAILABLE' });
});


test('actions can return no result; real errors are still preserved', async () => {
  const registry = new Registry('demo', 'pwa', () => ({}));
  let delivered = false;
  registry.register({ id: 'demo.deliver', title: 'Deliver action', run: () => { delivered = true; } });
  assert.equal(await registry.execute('demo.deliver'), null);
  assert.equal(delivered, true);
  registry.register({ id: 'demo.fail', title: 'Fail', run: () => { throw new Error('Provider error'); } });
  await assert.rejects(registry.execute('demo.fail'), { message: 'Provider error' });
});
test('text inputs are bounded and propagated; no-input actions reject unexpected arguments', async () => {
  const registry = new Registry('demo', 'browser', () => ({}));
  registry.register({ id: 'demo.question', title: 'Question', input: 'text', run: (_context, input) => input! });
  assert.equal(await registry.execute('demo.question','What is a capability?'), 'What is a capability?');
  for (const input of [undefined,'','   ','x'.repeat(2001)]) await assert.rejects(registry.execute('demo.question',input), { code: 'INVALID_INPUT' });
  const req = request('execute','demo.question',undefined,'Hello');
  assert.equal(isRequest(req), true);
  assert.equal(isRequest({ ...req, input: 'x'.repeat(2001) }), false);
  registry.register({ id: 'demo.empty', title: 'No input', run: () => null });
  await assert.rejects(registry.execute('demo.empty','Unexpected'), { code: 'INVALID_INPUT' });
});


test('missing execution replies are unconfirmed handoffs, not discovery success', () => {
  assert.deepEqual(unwrap(undefined, request('execute','demo.action')), { message: 'Action sent; no result returned.' });
  assert.throws(() => unwrap(undefined, request('discover')), { code: 'INVALID_RESPONSE' });
});


test('saved pairing settings reject reserved identities, duplicates, and invalid permissions', () => {
  const provider = {providerId:'workspaces',name:'Workspaces',extensionId:'a'.repeat(32),enabled:true,shareTabContext:false};
  assert.deepEqual(savedProviders([provider]),[provider]);
  assert.deepEqual(savedProviders(undefined),[]);
  for (const value of [[provider,provider],[{...provider,providerId:'browser'}],[{...provider,extensionId:'bad'}],[{...provider,shareTabContext:'true'}],[{...provider,name:' '}],{}]) {
    assert.throws(()=>savedProviders(value),{code:'INVALID_SETTINGS'});
  }
  assert.equal(isRequest(request('describe')),true);
});

test('registration fails early at the discovery protocol limits', () => {
  assert.throws(()=>new Registry('Bad ID','pwa',()=>null),{code:'INVALID_PROVIDER'});
  const registry = new Registry('limits','pwa',()=>null);
  const command = {id:'limits.action',title:'Action',run:()=>null};
  for (const metadata of [{description:'x'.repeat(301)},{description:' '},{input:'number'},{title:'x'.repeat(121)}]) {
    assert.throws(()=>registry.register({...command,...metadata} as never),{code:'INVALID_CAPABILITY'});
  }
  for (let i=0;i<50;i++) registry.register({...command,id:`limits.action-${i}`,description:'x'.repeat(300)});
  assert.equal(descriptors(registry.list(),'limits','pwa').length,50);
  assert.throws(()=>registry.register(command),{code:'CAPABILITY_LIMIT'});
});

test('PWA scopes separate the hub from sibling apps and retain exact-origin checks', () => {
  const hub = pwaScope('https://page-apps.github.io/');
  const child = pwaScope('https://page-apps.github.io/quick-log/');
  assert.equal(matchesPwa(hub,'https://page-apps.github.io/'),true);
  assert.equal(matchesPwa(hub,'https://page-apps.github.io/quick-log/'),false);
  assert.equal(matchesPwa(child,'https://page-apps.github.io/quick-log/editor'),true);
  for (const url of ['https://page-apps.github.io/quick-logger/','https://page-apps.github.io.evil/quick-log/','http://page-apps.github.io/quick-log/']) assert.equal(matchesPwa(child,url),false);
  for (const url of ['https://user:password@example.com/','javascript:alert(1)','https://example.com/?secret=fixture','https://example.com/%2fchild','https://example.com/*']) assert.throws(()=>pwaScope(url),{code:'INVALID_ORIGIN'});
  assert.equal(hostPattern(pwaScope('http://localhost:5173/')),'http://localhost/*');
  const saved = {...hub,providerId:'personal-hub',name:'Personal Hub',enabled:true};
  assert.deepEqual(savedPwas([saved]),[saved]);
  for (const value of [[saved,saved],[{...saved,providerId:'browser'}],[{...saved,path:'/quick-log'}]]) assert.throws(()=>savedPwas(value));
  assert.equal(isRequest({...request('discover'),providerId:'personal-hub'}),true);
  assert.equal(isRequest({...request('discover'),providerId:'INVALID'}),false);
});
