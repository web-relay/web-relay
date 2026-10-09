import { updatePairings } from './pairing';
import { CapabilityError } from '@web-relay/core';
import { bounded, descriptors, record, request, unwrap, VERSION } from '@web-relay/protocol';
import type { CapabilityDescriptor, JsonValue } from '@web-relay/core';
import type { TabContext } from '@web-relay/protocol';
import { pwaProviders, extensionProviders } from './providers';

export interface PwaScope { origin: string; path: string }
export interface SavedPwa extends PwaScope { providerId: string; name: string; enabled: boolean; commands?: CapabilityDescriptor[]; url?: string }
const KEY = 'pairedPwaProviders', PROPOSAL = 'pwaPairingProposal';
const reserved = new Set(['browser','tabs',...extensionProviders.map(p=>p.providerId),...pwaProviders.map(p=>p.providerId)]);
export function pwaScope(value: unknown): PwaScope {
  if (typeof value !== 'string' || value.length > 8192) throw new CapabilityError('INVALID_ORIGIN', 'Enter the full HTTP(S) app URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new CapabilityError('INVALID_ORIGIN', 'Enter the full HTTP(S) app URL.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[%*\\]/.test(url.pathname)) {
    throw new CapabilityError('INVALID_ORIGIN', 'Use an HTTP(S) URL without credentials, query, fragment, wildcard or encoded path.');
  }
  return {origin:url.origin,path:url.pathname === '/' ? '/' : url.pathname.replace(/\/$/,'')+'/'};
}
export function matchesPwa(scope: PwaScope, value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === scope.origin && (scope.path === '/' ? url.pathname === '/' : url.pathname === scope.path.slice(0,-1) || url.pathname.startsWith(scope.path));
  } catch { return false; }
}
export const hostPattern = (scope: PwaScope) => { const url = new URL(scope.origin); return `${url.protocol}//${url.hostname}/*`; };
export function savedPwas(value: unknown): SavedPwa[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new CapabilityError('INVALID_SETTINGS','Invalid PWA settings.');
  const ids = new Set<string>();
  return value.map(item=>{
    if (!record(item) || typeof item.providerId !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(item.providerId)
      || reserved.has(item.providerId) || ids.has(item.providerId) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120
      || typeof item.enabled !== 'boolean' || typeof item.origin !== 'string' || typeof item.path !== 'string') {
      throw new CapabilityError('INVALID_SETTINGS','Invalid or duplicate PWA settings.');
    }
    const scope = pwaScope(item.origin+item.path);
    if (scope.origin !== item.origin || scope.path !== item.path) throw new CapabilityError('INVALID_SETTINGS','Invalid PWA scope.');
    if (item.url !== undefined) {
      const entry = pwaScope(item.url);
      if (entry.origin !== scope.origin || entry.path !== scope.path) throw new CapabilityError('INVALID_SETTINGS','App entry URL is outside its paired scope.');
    }
    ids.add(item.providerId);
    return {...scope,providerId:item.providerId,name:item.name,enabled:item.enabled,...(typeof item.url === 'string' ? {url:new URL(item.url).href} : {}),...(item.commands !== undefined ? {commands:descriptors(item.commands,item.providerId,'pwa')} : {})};
  });
}
export async function loadSavedPwas() { return savedPwas((await chrome.storage.local.get(KEY))[KEY]); }
export async function matchingPwas(url: string): Promise<SavedPwa[]> {
  const defaults = pwaProviders.flatMap(p=>p.origins.map(origin=>({origin,path:'/',providerId:p.providerId,name:p.name,enabled:true})))
    // Preserve the bundled demo's original origin-wide behavior.
    .filter(p=>new URL(url).origin === p.origin);
  return [...defaults,...(await loadSavedPwas()).filter(p=>p.enabled && matchesPwa(p,url))];
}
export async function sendPwa(type: 'describe'|'discover'|'execute', context: TabContext, providerId?: string, id?: string, input?: string, documentId?: string): Promise<JsonValue> {
  if (!await chrome.permissions.contains({origins:[hostPattern({origin:new URL(context.url).origin,path:'/'})]})) throw new CapabilityError('PERMISSION_REQUIRED','Site access was revoked. Approve it again in app pairing settings.');
  // Inject on demand: new pairings work on already-open tabs and after navigation.
  // The bridge is idempotent and forwards only requests from this extension.
  const [injected] = await chrome.scripting.executeScript({target:{tabId:context.tabId,frameIds:[0]},files:['content.js']});
  if (documentId && injected?.documentId !== documentId) throw new CapabilityError('STALE_CONTEXT','The app page changed. Refresh the launcher.');
  const req = {...request(type,id,context,input),...(providerId ? {providerId} : {})};
  return unwrap(await bounded(chrome.tabs.sendMessage(context.tabId,req,{documentId:documentId ?? injected!.documentId})),req);
}
async function probe(scope: PwaScope) {
  if (!await chrome.permissions.contains({origins:[hostPattern(scope)]})) throw new CapabilityError('PERMISSION_REQUIRED','Approve browser access to this host, then check the connection.');
  const tabs = (await chrome.tabs.query({})).filter(tab=>tab.id !== undefined && tab.incognito === chrome.extension.inIncognitoContext && tab.url && matchesPwa(scope,tab.url));
  if (tabs.length !== 1) throw new CapabilityError('OPEN_APP', 'Open exactly one tab at this app path, then check the connection.');
  const context = {tabId:tabs[0].id!,url:tabs[0].url!};
  let value: JsonValue;
  try { value = await sendPwa('describe',context); }
  catch (error) {
    if (!(error instanceof CapabilityError) || !['UNSUPPORTED_REQUEST','TIMEOUT'].includes(error.code)) throw new CapabilityError('PAIRING_FAILED','No compatible app responded. Open the app and confirm its SDK bridge is mounted.');
    // SDK <=0.1.3 has no PWA describe; use validated discovery for existing apps.
    const commands = await sendPwa('discover',context);
    if (!Array.isArray(commands) || !record(commands[0]) || typeof commands[0].providerId !== 'string') throw new CapabilityError('EMPTY_PROVIDER','Enable an app command or upgrade its SDK before pairing.');
    descriptors(commands,commands[0].providerId,'pwa');
    value = {providerId:commands[0].providerId,name:commands[0].providerId,protocolVersion:VERSION};
  }
  if (!record(value) || typeof value.providerId !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(value.providerId)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || value.protocolVersion !== VERSION) {
    throw new CapabilityError('INVALID_RESPONSE','Invalid app identity or protocol version.');
  }
  return {providerId:value.providerId,name:value.name,protocolVersion:VERSION};
}
async function noCollision(providerId: string) {
  const saved = await loadSavedPwas();
  const extensions = (await chrome.storage.local.get('pairedExtensionProviders')).pairedExtensionProviders;
  if (reserved.has(providerId) || saved.some(p=>p.providerId === providerId) || (Array.isArray(extensions) && extensions.some(p=>p.providerId === providerId))) throw new CapabilityError('ALREADY_PAIRED','That provider ID is already paired or reserved.');
  if (saved.length >= 20) throw new CapabilityError('PAIRING_LIMIT','Remove a PWA before adding another (maximum 20).');
  return saved;
}
export async function checkPwa(url: unknown, owner: string) {
  const scope = pwaScope(url), identity = await probe(scope);
  await noCollision(identity.providerId);
  const proposal = {...scope,...identity,url:new URL(String(url)).href,token:crypto.randomUUID(),owner,expires:Date.now()+300000};
  await chrome.storage.session.set({[PROPOSAL]:proposal});
  return proposal;
}
export function approvePwa(token: unknown, owner: string) {
  return updatePairings(async()=>{
    const pending = (await chrome.storage.session.get(PROPOSAL))[PROPOSAL];
    if (!record(pending) || pending.token !== token || typeof token !== 'string' || pending.owner !== owner || typeof pending.expires !== 'number' || pending.expires < Date.now()) throw new CapabilityError('APPROVAL_REQUIRED','Check the app connection again before approving pairing.');
    const scope = pwaScope(String(pending.origin)+String(pending.path));
    const identity = await probe(scope);
    if (identity.providerId !== pending.providerId || identity.name !== pending.name) throw new CapabilityError('IDENTITY_CHANGED','App identity changed. Check its connection again.');
    const saved = await noCollision(identity.providerId);
    const tabs = (await chrome.tabs.query({})).filter(tab=>tab.id !== undefined && tab.incognito === chrome.extension.inIncognitoContext && tab.url && matchesPwa(scope,tab.url));
    const tab = tabs.length === 1 ? tabs[0] : undefined;
    if (!tab?.url || tab.id === undefined) throw new CapabilityError('OPEN_APP','Open the app before approving pairing.');
    const commands = descriptors(await sendPwa('discover',{tabId:tab.id,url:tab.url},identity.providerId),identity.providerId,'pwa');
    saved.push({...scope,providerId:identity.providerId,name:identity.name,enabled:true,commands,...(typeof pending.url === 'string' ? {url:pending.url} : {})});
    await chrome.storage.local.set({[KEY]:saved});
    await chrome.storage.session.remove(PROPOSAL);
    return saved;
  });
}
export function changePwa(providerId: unknown, enabled?: boolean) {
  return updatePairings(async()=>{
    const saved = await loadSavedPwas();
    const selected = saved.find(p=>p.providerId === providerId);
    if (!selected) throw new CapabilityError('NOT_FOUND','This app pairing no longer exists.');
    const next = enabled === undefined ? saved.filter(p=>p !== selected) : saved.map(p=>p === selected ? {...p,enabled} : p);
    await chrome.storage.local.set({[KEY]:next});
    return next;
  });
}

// Catalog updates share the pairing lock so discovery cannot resurrect removed apps.
export function cachePwaCommands(providerId: string, commands: CapabilityDescriptor[]) {
  return updatePairings(async()=>{
    const saved = await loadSavedPwas();
    if (!saved.some(app=>app.providerId === providerId && app.enabled)) throw new CapabilityError('UNAVAILABLE','This app was disabled or removed.');
    await chrome.storage.local.set({[KEY]:saved.map(app=>app.providerId === providerId ? {...app,commands} : app)});
  });
}
