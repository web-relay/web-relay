import { webMcpSiteUrl } from './webmcp-sites';
import type { SavedWebMcpSite, SavedWebMcpTool } from './webmcp-sites';
import { pwaScope, hostPattern } from './pwa-pairing';
import type { SavedPwa } from './pwa-pairing';
import { bounded, record } from '@web-relay/protocol';
import type { SavedProvider } from './pairing';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element('status');
let token: string | undefined;
let busy = false;
async function api(message: Record<string, unknown>): Promise<unknown> {
  const result: unknown = await bounded(chrome.runtime.sendMessage({channel:'web-relay:panel',version:1,...message}),15000);
  if (!record(result) || result.ok !== true) throw new Error(record(result) && record(result.error) && typeof result.error.message === 'string' ? result.error.message : 'Could not update pairing.');
  return result.data;
}
function cancel() {
  token = undefined;
  element('review').hidden = true;
  element<HTMLInputElement>('share-context').checked = false;
}
async function task(run: () => Promise<void>) {
  if (busy) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=true);
  try { await run(); }
  catch (error) { status.textContent = error instanceof Error ? error.message : 'Pairing failed.'; }
  finally { busy = false; document.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=false); }
}
function render(providers: SavedProvider[]) {
  const list = element('paired'); list.replaceChildren();
  if (!providers.length) { const empty = document.createElement('p'); empty.textContent = 'No additional providers paired.'; list.append(empty); }
  for (const provider of providers) {
    const row = document.createElement('div'); row.className = 'paired-provider';
    const title = document.createElement('h3'); title.textContent = provider.name;
    const detail = document.createElement('p'); detail.textContent = `${provider.providerId} · ${provider.extensionId}`;
    const context = document.createElement('p'); context.textContent = provider.shareTabContext ? 'Current tab URL sharing enabled.' : 'Current tab URL is not shared.';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = provider.enabled ? 'Disable' : 'Enable'; toggle.setAttribute('aria-label',`${toggle.textContent} ${provider.name}`);
    toggle.addEventListener('click', event=>{ if (event.isTrusted) void task(async()=>{
      render(await api({type:'pairing-enable',extensionId:provider.extensionId,enabled:!provider.enabled}) as SavedProvider[]);
      status.textContent = 'Provider preference saved. Refresh the launcher to update commands.';
    }); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label',`Remove ${provider.name}`);
    remove.addEventListener('click', event=>{ if (event.isTrusted) void task(async()=>{
      render(await api({type:'pairing-remove',extensionId:provider.extensionId}) as SavedProvider[]);
      status.textContent = 'Pairing removed. Refresh the launcher to update commands.';
    }); });
    row.append(title,detail,context,toggle,remove); list.append(row);
  }
}
async function load() {
  const data = await api({type:'pairing-list'}) as {launcherId:string;providers:SavedProvider[]};
  element('launcher-id').textContent = data.launcherId;
  render(data.providers);
  renderPwas(await api({type:'pwa-list'}) as SavedPwa[]);
  renderWebMcpSites(await api({type:'webmcp-site-list'}) as SavedWebMcpSite[]);
}
element('pairing-form').addEventListener('submit', event=>{
  event.preventDefault();
  if (!event.isTrusted) return;
  void task(async()=>{
    cancel(); cancelPwa(); cancelWebMcpSite(); status.textContent = 'Checking connection…';
    const data = await api({type:'pairing-check',extensionId:element<HTMLInputElement>('extension-id').value.trim()}) as {token:string;name:string;providerId:string;extensionId:string;protocolVersion:number};
    token = data.token;
    element('review-name').textContent = data.name;
    element('review-provider').textContent = data.providerId;
    element('review-extension').textContent = data.extensionId;
    element('review-version').textContent = String(data.protocolVersion);
    element('review').hidden = false;
    status.textContent = 'Connected. Review this provider, then approve pairing.';
  });
});
element('extension-id').addEventListener('input', cancel);
element('cancel').addEventListener('click', cancel);
element('approve').addEventListener('click', event=>{
  if (!event.isTrusted || !token) return;
  void task(async()=>{
    const providers = await api({type:'pairing-approve',token,shareTabContext:element<HTMLInputElement>('share-context').checked});
    cancel(); render(providers as SavedProvider[]);
    status.textContent = 'Provider paired. Refresh the launcher to discover its commands.';
  });
});
element('reload').addEventListener('click', event=>{ if (event.isTrusted) void task(async()=>{cancel();cancelPwa();cancelWebMcpSite();await load();status.textContent='Saved providers refreshed.';}); });


let pwaToken: string | undefined;
const pwaStatus = element('pwa-status');
function cancelPwa() { pwaToken = undefined; element('pwa-review').hidden = true; }
function renderPwas(providers: SavedPwa[]) {
  const list = element('pwa-paired'); list.replaceChildren();
  if (!providers.length) { const empty = document.createElement('p'); empty.textContent = 'No web apps paired.'; list.append(empty); }
  for (const provider of providers) {
    const row = document.createElement('div'); row.className = 'paired-provider';
    const title = document.createElement('h3'); title.textContent = provider.name;
    const detail = document.createElement('p'); detail.textContent = `${provider.providerId} · ${provider.origin}${provider.path}`;
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = provider.enabled ? 'Disable app' : 'Enable app'; toggle.setAttribute('aria-label',`${toggle.textContent} ${provider.name}`);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove app'; remove.setAttribute('aria-label',`Remove app ${provider.name}`);
    const change = (type: string, enabled?: boolean) => task(async()=>{
      renderPwas(await api({type,providerId:provider.providerId,enabled}) as SavedPwa[]);
      pwaStatus.textContent = 'App preference saved. Refresh the launcher to update commands.';
    });
    toggle.addEventListener('click',event=>{if(event.isTrusted) void change('pwa-enable',!provider.enabled);});
    remove.addEventListener('click',event=>{if(event.isTrusted) void change('pwa-remove');});
    row.append(title,detail,toggle,remove); list.append(row);
  }
}
element('pwa-form').addEventListener('submit',event=>{
  event.preventDefault(); if (!event.isTrusted) return;
  void task(async()=>{
    cancelPwa(); cancel(); cancelWebMcpSite();
    const url = element<HTMLInputElement>('pwa-url').value.trim();
    const scope = pwaScope(url);
    pwaStatus.textContent = 'Requesting site access and checking connection…';
    if (!await chrome.permissions.request({origins:[hostPattern(scope)]})) {
      pwaStatus.textContent = 'Site access was declined. The app was not paired.'; return;
    }
    const data = await api({type:'pwa-check',url}) as SavedPwa & {token:string};
    pwaToken = data.token;
    element('pwa-identity').textContent = `${data.name} · ${data.providerId} · ${data.origin}${data.path}`;
    element('pwa-review').hidden = false;
    pwaStatus.textContent = 'Connected. Review the app, then approve pairing.';
  });
});
element('pwa-url').addEventListener('input',cancelPwa);
element('pwa-cancel').addEventListener('click',cancelPwa);
element('pwa-approve').addEventListener('click',event=>{
  if (!event.isTrusted || !pwaToken) return;
  void task(async()=>{
    renderPwas(await api({type:'pwa-approve',token:pwaToken}) as SavedPwa[]);
    cancelPwa(); pwaStatus.textContent = 'App paired. Refresh the launcher to discover its commands.';
  });
});

let webMcpToken: string | undefined;
function webMcpTask(run: () => Promise<void>) {
  return task(async()=>{
    try { await run(); } catch(error) { element('webmcp-site-status').textContent = error instanceof Error ? error.message : 'Could not update the site.'; }
  });
}
function cancelWebMcpSite() { webMcpToken = undefined; element('webmcp-site-review').hidden = true; }
function renderWebMcpSites(sites: SavedWebMcpSite[]) {
  const list = element('webmcp-site-saved'); list.replaceChildren();
  if (!sites.length) { const empty = document.createElement('p'); empty.textContent = 'No WebMCP sites registered.'; list.append(empty); }
  for (const site of sites) {
    const row = document.createElement('div'); row.className = 'paired-provider';
    const title = document.createElement('h3'); title.textContent = site.name;
    const detail = document.createElement('p'); detail.textContent = `${site.url} · ${site.tools.length} saved tools`;
    const action = (label: string, type: string, enabled?: boolean) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label',`${label} ${site.name}`);
      button.addEventListener('click',event=>{if(event.isTrusted) void webMcpTask(async()=>{
        const data = await api({type,id:site.id,enabled}); renderWebMcpSites(data as SavedWebMcpSite[]);
        element('webmcp-site-status').textContent = 'Saved site updated. Refresh the launcher to update its tools.';
      });}); return button;
    };
    const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Restore site access';
    restore.setAttribute('aria-label',`Restore site access ${site.name}`);
    restore.addEventListener('click',event=>{if(event.isTrusted) void webMcpTask(async()=>{
      const allowed = await chrome.permissions.request({origins:[hostPattern({origin:new URL(site.url).origin,path:'/'})]});
      element('webmcp-site-status').textContent = allowed ? 'Site access restored. Refresh the launcher.' : 'Site access was declined.';
    });});
    row.append(title,detail,action(site.enabled ? 'Disable site' : 'Enable site','webmcp-site-enable',!site.enabled),
      action('Remove site','webmcp-site-remove'),action('Refresh site tools','webmcp-site-refresh'),restore); list.append(row);
  }
}
element('webmcp-site-form').addEventListener('submit',event=>{
  event.preventDefault(); if (!event.isTrusted) return;
  void webMcpTask(async()=>{
    cancelWebMcpSite(); cancel(); cancelPwa();
    const url = webMcpSiteUrl(element<HTMLInputElement>('webmcp-site-url').value.trim());
    const siteStatus = element('webmcp-site-status'); siteStatus.textContent = 'Requesting site access and discovering tools…';
    if (!await chrome.permissions.request({origins:[hostPattern({origin:new URL(url).origin,path:'/'})]})) {
      siteStatus.textContent = 'Site access was declined. The site was not registered.'; return;
    }
    const data = await api({type:'webmcp-site-check',url,name:element<HTMLInputElement>('webmcp-site-name').value.trim()}) as {token:string;url:string;name:string;tools:SavedWebMcpTool[]};
    webMcpToken = data.token;
    element('webmcp-site-identity').textContent = `${data.name} · ${data.url}`;
    const tools = element('webmcp-site-tools'); tools.replaceChildren();
    for (const tool of data.tools) { const item=document.createElement('li'); item.textContent = `${tool.title}${tool.description ? ' — '+tool.description : ''}`; tools.append(item); }
    element('webmcp-site-review').hidden = false;
    siteStatus.textContent = 'Review the page URL and tools, then register the site.';
  });
});
for (const id of ['webmcp-site-url','webmcp-site-name']) element(id).addEventListener('input',cancelWebMcpSite);
element('webmcp-site-cancel').addEventListener('click',cancelWebMcpSite);
element('webmcp-site-approve').addEventListener('click',event=>{
  if (!event.isTrusted || !webMcpToken) return;
  void webMcpTask(async()=>{
    renderWebMcpSites(await api({type:'webmcp-site-approve',token:webMcpToken}) as SavedWebMcpSite[]);
    cancelWebMcpSite(); element('webmcp-site-status').textContent = 'Site registered. Its tools are available from any tab.';
  });
});

void task(async()=>{await load();status.textContent='Ready to pair an extension.';});
