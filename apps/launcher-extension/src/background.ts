import { CapabilityError, Registry } from '@web-relay/core';
import type { CapabilityDescriptor, JsonValue } from '@web-relay/core';
import { bounded, descriptors, GITHUB_PROVIDER_ID, isContext, isPwaOrigin, record, request, unwrap } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';
import type { Snapshot } from './model';

async function activeContext(): Promise<TabContext | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id !== undefined && tab.url ? { tabId: tab.id, url: tab.url } : undefined;
}
async function validateContext(context: TabContext): Promise<void> {
  const current = await activeContext();
  if (!current || current.tabId !== context.tabId || current.url !== context.url) {
    throw new CapabilityError('STALE_CONTEXT', 'The active page changed. Refresh the launcher.');
  }
}
function browserRegistry(context?: TabContext) {
  const registry = new Registry('browser', 'browser', () => context);
  registry.register({ id: 'browser.new-tab', title: 'Open new tab', run: async () => {
    await chrome.tabs.create({}); return { message: 'Opened a new tab.' };
  } });
  registry.register({ id: 'browser.downloads', title: 'Open downloads', run: async () => {
    await chrome.tabs.create({ url: 'chrome://downloads/' }); return { message: 'Opened downloads.' };
  } });
  registry.register({ id: 'browser.copy-url', title: 'Copy current URL', when: ctx => !!ctx && /^https?:\/\//.test(ctx.url), run: ctx => ({ clipboard: ctx!.url, message: 'Copied the current URL.' }) });
  registry.register({ id: 'browser.duplicate-tab', title: 'Duplicate current tab', when: ctx => !!ctx && /^https?:\/\//.test(ctx.url), run: async ctx => {
    await chrome.tabs.duplicate(ctx!.tabId); return { message: 'Duplicated the current tab.' };
  } });
  return registry;
}
function githubContext(context?: TabContext): TabContext | undefined {
  return context && new URL(context.url).origin === 'https://github.com' ? context : undefined;
}
async function callPwa(type: 'discover' | 'execute', context: TabContext, id?: string): Promise<JsonValue> {
  const req = request(type, id, context);
  return unwrap(await bounded(chrome.tabs.sendMessage(context.tabId, req, { frameId: 0 })), req);
}
async function callGithub(type: 'discover' | 'execute', context?: TabContext, id?: string): Promise<JsonValue> {
  const req = request(type, id, githubContext(context));
  return unwrap(await bounded(chrome.runtime.sendMessage(GITHUB_PROVIDER_ID, req)), req);
}
async function discover(): Promise<Snapshot> {
  const context = await activeContext();
  const capabilities: CapabilityDescriptor[] = [];
  const sources: Snapshot['sources'] = [{ name: 'Browser', status: 'connected', detail: 'Built-in actions' }];
  if (context && isPwaOrigin(context.url)) {
    try {
      capabilities.push(...descriptors(await callPwa('discover', context), 'demo-notes', 'pwa'));
      sources.push({ name: 'Notes PWA', status: 'connected', detail: 'Active local application' });
    } catch (error) { sources.push({ name: 'Notes PWA', status: 'unavailable', detail: error instanceof Error ? error.message : 'Not connected' }); }
  } else sources.push({ name: 'Notes PWA', status: 'unavailable', detail: 'Open localhost:4173 to discover app actions' });
  const settings = await chrome.storage.local.get('githubEnabled');
  if (settings.githubEnabled === false) sources.push({ name: 'GitHub provider', status: 'disabled', detail: 'Disabled in this launcher' });
  else {
    try {
      capabilities.push(...descriptors(await callGithub('discover', context), 'github', 'extension'));
      sources.push({ name: 'GitHub provider', status: 'connected', detail: githubContext(context) ? 'Active GitHub context' : 'Global project navigation' });
    } catch (error) { sources.push({ name: 'GitHub provider', status: 'unavailable', detail: 'Load the paired GitHub extension. ' + (error instanceof Error ? error.message : '') }); }
  }
  capabilities.push(...browserRegistry(context).list());
  return { ...(context ? { context } : {}), capabilities, sources };
}
async function execute(command: CapabilityDescriptor, context?: TabContext): Promise<JsonValue> {
  // Revalidate the active tab and re-discover providers, including the disabled-provider preference.
  if (context) await validateContext(context);
  const fresh = await discover();
  const available = fresh.capabilities.some(item => item.id === command.id && item.providerId === command.providerId && item.providerKind === command.providerKind);
  if (!available) throw new CapabilityError('UNAVAILABLE', 'This capability is no longer available. Refresh the launcher.');
  if (context) await validateContext(context);
  switch (command.providerKind) {
    case 'browser': return browserRegistry(context).execute(command.id);
    case 'pwa':
      if (!context || !isPwaOrigin(context.url)) throw new CapabilityError('UNTRUSTED_ORIGIN', 'PWA origin is not trusted.');
      return callPwa('execute', context, command.id);
    case 'extension': return callGithub('execute', context, command.id);
  }
}
chrome.runtime.onMessage.addListener((value: unknown, sender, sendResponse) => {
  // Content scripts and external extensions cannot use the privileged panel API.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html') || !record(value) || value.channel !== 'web-relay:panel' || value.version !== 1) return;
  (async () => {
    if (value.type === 'list') return discover();
    if (value.type === 'configure' && typeof value.githubEnabled === 'boolean') {
      await chrome.storage.local.set({ githubEnabled: value.githubEnabled }); return discover();
    }
    if (value.type === 'execute' && (value.context === undefined || isContext(value.context)) && record(value.command)) {
      const command = value.command;
      const kind = command.providerKind;
      if (typeof command.id !== 'string' || typeof command.providerId !== 'string' || !['browser','pwa','extension'].includes(String(kind))) throw new CapabilityError('INVALID_REQUEST', 'Invalid capability selection.');
      return execute(command as unknown as CapabilityDescriptor, value.context as TabContext | undefined);
    }
    throw new CapabilityError('INVALID_REQUEST', 'Invalid panel request.');
  })().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: {
    code: error instanceof CapabilityError ? error.code : 'EXECUTION_FAILED',
    message: error instanceof Error ? error.message : 'The request failed.',
  } }));
  return true;
});
