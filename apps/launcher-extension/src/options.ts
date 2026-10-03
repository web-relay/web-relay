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
}
element('pairing-form').addEventListener('submit', event=>{
  event.preventDefault();
  if (!event.isTrusted) return;
  void task(async()=>{
    cancel(); status.textContent = 'Checking connection…';
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
element('reload').addEventListener('click', event=>{ if (event.isTrusted) void task(async()=>{cancel();await load();status.textContent='Saved providers refreshed.';}); });
void task(async()=>{await load();status.textContent='Ready to pair an extension.';});
