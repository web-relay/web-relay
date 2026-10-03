import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityError, Registry } from '../packages/core/src/index';
import { bounded, descriptors, failure, isPwaOrigin, isRequest, request, success, unwrap } from '../packages/protocol/src/index';
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
