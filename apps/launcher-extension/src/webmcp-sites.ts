import { CapabilityError } from '@web-relay/core';
import { isJson, record } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';
import type { JsonValue } from '@web-relay/core';
import { updatePairings } from './pairing';
import { hostPattern } from './pwa-pairing';
import { discoverWebMcp, executeWebMcp, validateWebMcpInput } from './webmcp';
import type { WebMcpCommand } from './webmcp';

export interface SavedWebMcpTool { id: string; title: string; description?: string; inputSchema: JsonValue }
export interface SavedWebMcpSite { id: string; name: string; url: string; enabled: boolean; tools: SavedWebMcpTool[] }
const KEY = 'savedWebMcpSites', PROPOSAL = 'webMcpSiteProposal';
export function webMcpSiteUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new CapabilityError('INVALID_ORIGIN','Enter the full HTTP(S) site URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new CapabilityError('INVALID_ORIGIN','Enter the full HTTP(S) site URL.'); }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[%*\\]/.test(url.pathname)) {
    throw new CapabilityError('INVALID_ORIGIN','Use an HTTP(S) page URL without credentials, query, fragment, wildcard or encoded path.');
  }
  return url.href;
}
export function schemaKey(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : record(item) ?
    Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)])) : item;
  return JSON.stringify(canonical(value));
}
function savedTools(value: unknown): SavedWebMcpTool[] {
  if (!Array.isArray(value) || value.length > 50) throw new CapabilityError('INVALID_SETTINGS','Invalid saved WebMCP tools.');
  const ids = new Set<string>();
  return value.map(tool=>{
    if (!record(tool) || typeof tool.id !== 'string' || !tool.id || tool.id.length > 200 || ids.has(tool.id)
      || typeof tool.title !== 'string' || !tool.title.trim() || tool.title.length > 120
      || (tool.description !== undefined && (typeof tool.description !== 'string' || tool.description.length > 300))
      || !record(tool.inputSchema) || !isJson(tool.inputSchema) || JSON.stringify(tool.inputSchema).length > 32000) {
      throw new CapabilityError('INVALID_SETTINGS','Invalid or duplicate saved WebMCP tool.');
    }
    ids.add(tool.id);
    return {id:tool.id,title:tool.title,...(tool.description !== undefined ? {description:tool.description} : {}),inputSchema:tool.inputSchema};
  });
}
export function savedWebMcpSites(value: unknown): SavedWebMcpSite[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new CapabilityError('INVALID_SETTINGS','Invalid WebMCP site settings.');
  const ids = new Set<string>(), urls = new Set<string>();
  return value.map(site=>{
    if (!record(site) || typeof site.id !== 'string' || !/^webmcp-site\.[a-f0-9-]{36}$/.test(site.id) || ids.has(site.id)
      || typeof site.name !== 'string' || !site.name.trim() || site.name.length > 120 || typeof site.enabled !== 'boolean') {
      throw new CapabilityError('INVALID_SETTINGS','Invalid WebMCP site settings.');
    }
    const url = webMcpSiteUrl(site.url);
    if (url !== site.url || urls.has(url)) throw new CapabilityError('INVALID_SETTINGS','Invalid or duplicate saved WebMCP URL.');
    ids.add(site.id); urls.add(url);
    return {id:site.id,name:site.name,url,enabled:site.enabled,tools:savedTools(site.tools)};
  });
}
export async function loadWebMcpSites() { return savedWebMcpSites((await chrome.storage.local.get(KEY))[KEY]); }
async function permission(url: string) {
  if (!await chrome.permissions.contains({origins:[hostPattern({origin:new URL(url).origin,path:'/'})]})) {
    throw new CapabilityError('PERMISSION_REQUIRED','Site access was revoked. Grant access again in WebMCP site settings.');
  }
}
// Only deduplicate in-flight tab creation. Tool registrations remain page-owned.
const opening = new Map<string, Promise<TabContext>>();
async function sitePage(url: string): Promise<TabContext> {
  await permission(url);
  const pending = opening.get(url);
  if (pending) return pending;
  const task = (async()=>{
    const tabs = (await chrome.tabs.query({})).filter(tab=>tab.id !== undefined && tab.incognito === chrome.extension.inIncognitoContext && (tab.url === url || tab.pendingUrl === url));
    if (tabs.length > 1) throw new CapabilityError('AMBIGUOUS_PAGE','More than one tab has this saved page open. Close duplicate tabs before running its tools.');
    const tab = tabs[0] ?? await chrome.tabs.create({url,active:false});
    if (tab.id === undefined) throw new CapabilityError('UNAVAILABLE','Could not open the saved site.');
    if (tab.discarded) await chrome.tabs.reload(tab.id);
    return {tabId:tab.id,url};
  })();
  opening.set(url,task);
  try { return await task; } finally { if (opening.get(url) === task) opening.delete(url); }
}
async function probe(url: string, allowEmpty = false) {
  const context = await sitePage(url);
  const deadline = Date.now()+8000;
  let lastError: unknown;
  let empty: {context: TabContext; commands: WebMcpCommand[]} | undefined;
  do {
    await permission(url);
    const tab = await chrome.tabs.get(context.tabId);
    if (tab.status === 'complete' && tab.url !== url) throw new CapabilityError('UNTRUSTED_ORIGIN','The site redirected away from its saved URL. Register the final page URL instead.');
    if (tab.url === url && tab.status === 'complete') {
      try {
        const discovered = await discoverWebMcp(context);
        if (!discovered.supported) throw new CapabilityError('UNSUPPORTED_WEBMCP','Enable the Chrome WebMCP preview and confirm this page exposes native tools.');
        if (discovered.commands.length) return {context,commands:discovered.commands};
        empty = {context,commands:[]};
      } catch (error) {
        if (error instanceof CapabilityError && error.code === 'UNSUPPORTED_WEBMCP') throw error;
        lastError = error;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,150));
  } while (Date.now() < deadline);
  if (allowEmpty && empty) return empty;
  throw new CapabilityError('UNAVAILABLE',lastError instanceof Error ? lastError.message : 'No WebMCP tools appeared. Sign in or finish loading the site, then refresh its tools in settings.');
}
const catalog = (commands: WebMcpCommand[]) => savedTools(commands.map(({id,title,description,inputSchema})=>({id,title,...(description !== undefined ? {description} : {}),inputSchema})));
async function noCollision(url: string) {
  const sites = await loadWebMcpSites();
  if (sites.some(site=>site.url === url)) throw new CapabilityError('ALREADY_PAIRED','This WebMCP page is already registered.');
  if (sites.length >= 20) throw new CapabilityError('PAIRING_LIMIT','Remove a saved WebMCP site before adding another (maximum 20).');
  return sites;
}
export async function checkWebMcpSite(value: unknown, label: unknown, owner: string) {
  const url = webMcpSiteUrl(value);
  const name = label === undefined || label === '' ? new URL(url).hostname : label;
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new CapabilityError('INVALID_INPUT','Use a site name of 1–120 characters.');
  await noCollision(url);
  const {commands} = await probe(url);
  const proposal = {url,name,tools:catalog(commands),token:crypto.randomUUID(),owner,expires:Date.now()+300000};
  await chrome.storage.session.set({[PROPOSAL]:proposal});
  return proposal;
}
export function approveWebMcpSite(token: unknown, owner: string) {
  return updatePairings(async()=>{
    const pending = (await chrome.storage.session.get(PROPOSAL))[PROPOSAL];
    if (!record(pending) || typeof token !== 'string' || pending.token !== token || pending.owner !== owner || typeof pending.expires !== 'number' || pending.expires < Date.now()) {
      throw new CapabilityError('APPROVAL_REQUIRED','Check this site again before registering it.');
    }
    const url = webMcpSiteUrl(pending.url);
    const tools = catalog((await probe(url)).commands);
    if (schemaKey(tools) !== schemaKey(pending.tools)) throw new CapabilityError('IDENTITY_CHANGED','Site tools changed. Check the site again and review its tools.');
    const sites = await noCollision(url);
    sites.push({id:`webmcp-site.${crypto.randomUUID()}`,name:String(pending.name),url,enabled:true,tools});
    await chrome.storage.local.set({[KEY]:sites});
    await chrome.storage.session.remove(PROPOSAL);
    return sites;
  });
}
export function changeWebMcpSite(id: unknown, enabled?: boolean) {
  return updatePairings(async()=>{
    const sites = await loadWebMcpSites();
    if (!sites.some(site=>site.id === id)) throw new CapabilityError('NOT_FOUND','This saved WebMCP site no longer exists.');
    const next = enabled === undefined ? sites.filter(site=>site.id !== id) : sites.map(site=>site.id === id ? {...site,enabled} : site);
    await chrome.storage.local.set({[KEY]:next}); return next;
  });
}
async function updateCatalog(id: string, tools: SavedWebMcpTool[]) {
  return updatePairings(async()=>{
    const sites = await loadWebMcpSites();
    if (!sites.some(site=>site.id === id && site.enabled)) throw new CapabilityError('UNAVAILABLE','This WebMCP site was disabled or removed.');
    const next = sites.map(site=>site.id === id ? {...site,tools} : site);
    await chrome.storage.local.set({[KEY]:next}); return next;
  });
}
export async function refreshWebMcpSite(id: unknown) {
  const site = (await loadWebMcpSites()).find(site=>site.id === id && site.enabled);
  if (!site) throw new CapabilityError('UNAVAILABLE','Enable the saved site before refreshing its tools.');
  return updateCatalog(site.id,catalog((await probe(site.url,true)).commands));
}
export async function savedWebMcpSources() {
  return Promise.all((await loadWebMcpSites()).map(async site=>{
    const allowed = await chrome.permissions.contains({origins:[hostPattern({origin:new URL(site.url).origin,path:'/'})]});
    return {commands: site.enabled && allowed ? site.tools.map(tool=>({...tool,providerId:site.id,siteId:site.id,sourceName:`${site.name} · WebMCP`,providerKind:'webmcp' as const,input:'json' as const,documentId:''})) : [],
      source:{name:`${site.name} · WebMCP`,status:!site.enabled ? 'disabled' as const : allowed ? 'registered' as const : 'unavailable' as const,
        detail:allowed ? `Saved tools · ${site.url} · Opens the page when needed` : 'Browser site access was revoked. Restore it in site settings.'}};
  }));
}
export async function executeSavedWebMcp(command: WebMcpCommand, input: string | undefined, validateSource: () => Promise<void>) {
  validateWebMcpInput(input);
  const site = (await loadWebMcpSites()).find(site=>site.id === command.siteId && site.id === command.providerId && site.enabled);
  const selected = site?.tools.find(tool=>tool.id === command.id);
  if (!site || !selected) throw new CapabilityError('UNAVAILABLE','This saved tool was disabled or removed. Refresh the launcher.');
  if (schemaKey(selected) !== schemaKey(catalog([command])[0])) throw new CapabilityError('STALE_CONTEXT','Tool inputs changed. Refresh the launcher and review them again.');
  const {context,commands} = await probe(site.url,true);
  const tool = commands.find(tool=>tool.id === selected.id);
  const tools = catalog(commands);
  await updateCatalog(site.id,tools);
  if (!tool || schemaKey(catalog([tool])[0]) !== schemaKey(selected)) throw new CapabilityError('STALE_CONTEXT','Site tools changed. Refresh the launcher and review them again.');
  await validateSource();
  await permission(site.url);
  // Recheck saved authorization after waiting for page registration. Only one execution is sent.
  if (!(await loadWebMcpSites()).some(current=>current.id === site.id && current.enabled)) throw new CapabilityError('UNAVAILABLE','This WebMCP site was disabled or removed.');
  return executeWebMcp(tool,context,input);
}
