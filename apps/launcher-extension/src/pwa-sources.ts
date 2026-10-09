import { CapabilityError } from '@web-relay/core';
import type { CapabilityDescriptor } from '@web-relay/core';
import { descriptors } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';
import type { Snapshot } from './model';
import { cachePwaCommands, hostPattern, loadSavedPwas, matchesPwa, sendPwa } from './pwa-pairing';
import type { SavedPwa } from './pwa-pairing';

async function permitted(app: SavedPwa) {
  return chrome.permissions.contains({origins:[hostPattern(app)]});
}
async function appTabs(app: SavedPwa) {
  return (await chrome.tabs.query({})).filter(tab=>tab.id !== undefined && tab.incognito === chrome.extension.inIncognitoContext && (matchesPwa(app,tab.url ?? '') || matchesPwa(app,tab.pendingUrl ?? '')));
}
async function appPage(app: SavedPwa, caller?: TabContext) {
  const tabs = await appTabs(app);
  const current = tabs.find(tab=>tab.id === caller?.tabId);
  if (current) return current;
  if (tabs.length > 1) throw new CapabilityError('AMBIGUOUS_PAGE','More than one tab has this app open. Open its launcher there or close duplicate app tabs.');
  return tabs[0];
}
export async function savedPwaSources(caller?: TabContext) {
  return Promise.all((await loadSavedPwas()).map(async app=>{
    let commands: CapabilityDescriptor[] = [];
    let status: Snapshot['sources'][number]['status'] = 'disabled';
    let detail = 'Disabled in launcher settings';
    try {
      if (app.enabled) {
        if (!await permitted(app)) throw new CapabilityError('PERMISSION_REQUIRED','Browser site access was revoked. Restore access in app pairing settings.');
        const tab = await appPage(app,caller);
        if (tab?.id !== undefined && tab.url) {
          commands = descriptors(await sendPwa('discover',{tabId:tab.id,url:tab.url},app.providerId),app.providerId,'pwa');
          await cachePwaCommands(app.providerId,commands);
          status = 'connected'; detail = `Paired app · ${app.origin}${app.path}`;
        } else {
          commands = app.commands ?? [];
          status = 'registered'; detail = commands.length ? 'Saved actions · Opens the app when needed' : 'Open this app once to discover its actions';
        }
      }
    } catch (error) { commands = []; status = 'unavailable'; detail = error instanceof Error ? error.message : 'App unavailable'; }
    return {commands,source:{name:app.name,status,detail}};
  }));
}
// Only coalesce background tab creation. Functions and live availability remain app-owned.
const opening = new Map<string,Promise<chrome.tabs.Tab>>();
async function openApp(app: SavedPwa, caller?: TabContext) {
  const existing = await appPage(app,caller);
  if (existing) return existing;
  const pending = opening.get(app.providerId);
  if (pending) return pending;
  const task = chrome.tabs.create({url:app.url ?? app.origin+app.path,active:false});
  opening.set(app.providerId,task);
  try { return await task; } finally { if (opening.get(app.providerId) === task) opening.delete(app.providerId); }
}
export async function executeSavedPwa(command: CapabilityDescriptor, caller: TabContext | undefined, input: string | undefined, validateSource: () => Promise<void>) {
  const app = (await loadSavedPwas()).find(app=>app.providerId === command.providerId && app.enabled);
  if (!app) throw new CapabilityError('UNAVAILABLE','This app was disabled or removed. Refresh the launcher.');
  if (!await permitted(app)) throw new CapabilityError('PERMISSION_REQUIRED','Browser site access was revoked.');
  const tab = await openApp(app,caller);
  if (tab.id === undefined) throw new CapabilityError('UNAVAILABLE','Could not open this app.');
  if (tab.discarded) await chrome.tabs.reload(tab.id);
  const deadline = Date.now()+8000;
  let lastError: unknown;
  do {
    const live = await chrome.tabs.get(tab.id);
    if (live.status === 'complete') {
      if (!live.url || !matchesPwa(app,live.url)) throw new CapabilityError('UNTRUSTED_ORIGIN','The app moved outside its paired path. Open its approved page before running actions.');
      const context = {tabId:tab.id,url:live.url};
      let commands: CapabilityDescriptor[];
      let documentId: string;
      try {
        const [document] = await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>null});
        documentId = document!.documentId;
        commands = descriptors(await sendPwa('discover',context,app.providerId,undefined,undefined,documentId),app.providerId,'pwa');
      } catch (error) { lastError = error; await new Promise(resolve=>setTimeout(resolve,150)); continue; }
      await cachePwaCommands(app.providerId,commands);
      const selected = commands.find(item=>item.id === command.id);
      if (!selected) throw new CapabilityError('UNAVAILABLE','This action is no longer available in the app. Refresh the launcher.');
      if (selected.input !== command.input) throw new CapabilityError('STALE_CONTEXT','Action inputs changed. Refresh the launcher.');
      await validateSource();
      if (!(await loadSavedPwas()).some(current=>current.providerId === app.providerId && current.enabled)) throw new CapabilityError('UNAVAILABLE','This app was disabled or removed.');
      // Execution is sent exactly once, to the document whose registry was just checked.
      return sendPwa('execute',context,app.providerId,command.id,input,documentId);
    }
    await new Promise(resolve=>setTimeout(resolve,150));
  } while (Date.now()<deadline);
  throw new CapabilityError('UNAVAILABLE',lastError instanceof Error ? lastError.message : 'The app is still loading. Finish loading or sign in, then try again.');
}
