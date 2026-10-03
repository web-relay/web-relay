import { CapabilityError, Registry } from '@web-relay/core';
import type { CapabilityDescriptor, JsonValue } from '@web-relay/core';
import { bounded, descriptors, isContext, record, request, unwrap } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';
import type { Snapshot } from './model';
import { pwaProvider } from './providers';
import type { ExtensionProvider } from './providers';
import { allExtensionProviders, loadSavedProviders, checkPairing, approvePairing, changePairing } from './pairing';

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
async function tabsRegistry(context?: TabContext) {
  const windowId = context ? (await chrome.tabs.get(context.tabId)).windowId : undefined;
  const tabs = await chrome.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
  const registry = new Registry('tabs', 'browser', () => context);
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const tabId = tab.id;
    registry.register({
      id: `tabs.switch-${tabId}`,
      title: `Switch to ${tab.title || tab.url || 'Untitled tab'}`.slice(0,120),
      description: `${tab.active ? 'Current tab · ' : ''}${tab.url || ''}`.slice(0,300),
      run: async () => {
        const target = await chrome.tabs.get(tabId);
        if (target.windowId !== tab.windowId) throw new CapabilityError('STALE_CONTEXT', 'That tab moved to another window. Refresh the launcher.');
        await chrome.tabs.update(tabId, { active: true });
        return { message: 'Switched tab.' };
      },
    });
  }
  return registry;
}
async function callPwa(type: 'discover' | 'execute', context: TabContext, id?: string, input?: string): Promise<JsonValue> {
  const req = request(type, id, context, input);
  return unwrap(await bounded(chrome.tabs.sendMessage(context.tabId, req, { frameId: 0 })), req);
}
async function callExtension(provider: ExtensionProvider, type: 'discover' | 'execute', context?: TabContext, id?: string, input?: string): Promise<JsonValue> {
  const filteredContext = context && (!provider.contextOrigins || provider.contextOrigins.includes(new URL(context.url).origin)) ? context : undefined;
  const req = request(type, id, filteredContext, input);
  return unwrap(await bounded(chrome.runtime.sendMessage(provider.extensionId, req)), req);
}
async function discover(sourceContext?: TabContext): Promise<Snapshot> {
  const context = sourceContext ?? await activeContext();
  const capabilities: CapabilityDescriptor[] = [];
  const sources: Snapshot['sources'] = [{ name: 'Browser', status: 'connected', detail: 'Built-in actions' }];
  const pwa = context && pwaProvider(context.url);
  if (context && pwa) {
    try {
      capabilities.push(...descriptors(await callPwa('discover', context), pwa.providerId, 'pwa'));
      sources.push({ name:pwa.name, status:'connected', detail:'Active configured application' });
    } catch (error) { sources.push({ name:pwa.name, status:'unavailable', detail:error instanceof Error ? error.message : 'Not connected' }); }
  } else sources.push({ name:'Notes PWA', status:'unavailable', detail:'Open a configured PWA origin to discover app actions' });
  const settings = await chrome.storage.local.get(null);
  const discovered = await Promise.all((await allExtensionProviders()).map(async provider => {
    if (provider.enabled === false || (provider.enabledSetting && settings[provider.enabledSetting] === false)) {
      return { commands:[] as CapabilityDescriptor[], source:{ name:provider.name, status:'disabled' as const, detail:'Disabled in this launcher' } };
    }
    try {
      return { commands:descriptors(await callExtension(provider, 'discover', context),provider.providerId,'extension'), source:{ name:provider.name,status:'connected' as const,detail:'Paired extension provider' } };
    } catch (error) {
      return { commands:[] as CapabilityDescriptor[], source:{ name:provider.name,status:'unavailable' as const,detail:'Load the paired extension. ' + (error instanceof Error ? error.message : '') } };
    }
  }));
  for (const {commands,source} of discovered) { capabilities.push(...commands); sources.push(source); }
  capabilities.push(...browserRegistry(context).list(), ...(await tabsRegistry(context)).list());
  sources.push({ name: 'Tabs', status: 'connected', detail: 'Tabs in this window' });
  return { ...(context ? { context } : {}), capabilities, sources };
}
async function execute(command: CapabilityDescriptor, context?: TabContext, input?: string): Promise<JsonValue> {
  // Revalidate the active tab and re-discover providers, including the disabled-provider preference.
  if (context) await validateContext(context);
  const fresh = await discover();
  const available = fresh.capabilities.some(item => item.id === command.id && item.providerId === command.providerId && item.providerKind === command.providerKind);
  if (!available) throw new CapabilityError('UNAVAILABLE', 'This capability is no longer available. Refresh the launcher.');
  if (context) await validateContext(context);
  switch (command.providerKind) {
    case 'browser':
      if (command.providerId === 'tabs') return (await tabsRegistry(context)).execute(command.id, input);
      return browserRegistry(context).execute(command.id, input);
    case 'pwa':
      if (!context || !pwaProvider(context.url)) throw new CapabilityError('UNTRUSTED_ORIGIN', 'PWA origin is not trusted.');
      return callPwa('execute', context, command.id, input);
    case 'extension': {
      const provider = (await allExtensionProviders()).find(provider=>provider.providerId === command.providerId && provider.enabled !== false);
      if (!provider) throw new CapabilityError('UNTRUSTED_PROVIDER', 'Unknown extension provider.');
      return callExtension(provider, 'execute', context, command.id, input);
    }
  }
}
chrome.runtime.onMessage.addListener((value: unknown, sender, sendResponse) => {
  // Only this extension's own UI scripts can call the panel API. Page scripts
  // cannot access the isolated world's runtime API; page-bridge messages are separate.
  const injected = sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:\/\//.test(sender.url || '');
  const diagnostic = sender.url === chrome.runtime.getURL('popup.html');
  const settingsPage = sender.url === chrome.runtime.getURL('options.html');
  if (sender.id !== chrome.runtime.id || (!injected && !diagnostic && !settingsPage) || !record(value) || value.channel !== 'web-relay:panel' || value.version !== 1) return;
  const sourceContext = injected ? { tabId: sender.tab!.id!, url: sender.url! } : undefined;
  (async () => {
    if (value.type === 'open-settings') { await chrome.runtime.openOptionsPage(); return null; }
    if (typeof value.type === 'string' && value.type.startsWith('pairing-')) {
      if (!settingsPage) throw new CapabilityError('UNTRUSTED_SENDER', 'Pairing can only be changed in extension settings.');
      const owner = sender.documentId ?? String(sender.tab?.id ?? 'settings');
      if (value.type === 'pairing-list') return {launcherId:chrome.runtime.id,providers:await loadSavedProviders()};
      if (value.type === 'pairing-check') return checkPairing(value.extensionId,owner);
      if (value.type === 'pairing-approve') return approvePairing(value.token,value.shareTabContext,owner);
      if (value.type === 'pairing-remove') return changePairing(value.extensionId);
      if (value.type === 'pairing-enable' && typeof value.enabled === 'boolean') return changePairing(value.extensionId,value.enabled);
      throw new CapabilityError('INVALID_REQUEST', 'Invalid pairing request.');
    }
    if (value.type === 'list') return discover(sourceContext);
    if (value.type === 'open-handoff' && typeof value.url === 'string' && ['https://chatgpt.com/', 'https://gemini.google.com/app'].includes(value.url)) {
      if (sourceContext) await validateContext(sourceContext);
      await chrome.tabs.create({ url: value.url });
      return null;
    }
    if (value.type === 'configure' && typeof value.githubEnabled === 'boolean') {
      await chrome.storage.local.set({ githubEnabled: value.githubEnabled }); return discover(sourceContext);
    }
    if (value.type === 'execute' && (value.context === undefined || isContext(value.context)) && record(value.command)) {
      const command = value.command;
      const kind = command.providerKind;
      if (typeof command.id !== 'string' || typeof command.providerId !== 'string' || !['browser','pwa','extension'].includes(String(kind))) throw new CapabilityError('INVALID_REQUEST', 'Invalid capability selection.');
      if (value.input !== undefined && (typeof value.input !== 'string' || value.input.length > 2000)) throw new CapabilityError('INVALID_INPUT', 'Invalid question input.');
      if (sourceContext && (!isContext(value.context) || sourceContext.tabId !== value.context.tabId || sourceContext.url !== value.context.url)) throw new CapabilityError('STALE_CONTEXT', 'The source page changed. Reopen the launcher.');
      return execute(command as unknown as CapabilityDescriptor, value.context as TabContext | undefined, value.input as string | undefined);
    }
    throw new CapabilityError('INVALID_REQUEST', 'Invalid panel request.');
  })().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: {
    code: error instanceof CapabilityError ? error.code : 'EXECUTION_FAILED',
    message: error instanceof Error ? error.message : 'The request failed.',
  } }));
  return true;
});


/** Stateless event-driven broker: every click injects a fresh UI; no worker-held registry. */
export async function openLauncher(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.set({ launcherTabId: tabId });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: 'Web Relay cannot open on this page. Open a regular website and try again.' });
  }
}
chrome.action.onClicked.addListener(tab => { if (tab.id !== undefined) void openLauncher(tab.id); });

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    const { launcherTabId } = await chrome.storage.session.get('launcherTabId');
    if (typeof launcherTabId === 'number' && launcherTabId !== tabId) {
      try { await chrome.tabs.sendMessage(launcherTabId, { channel: 'web-relay:ui', type: 'dismiss' }, { frameId: 0 }); } catch { /* Navigated or already gone. */ }
    }
  })();
});
