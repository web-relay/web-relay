import type { CapabilityDescriptor } from '@web-relay/core';
import { bounded, record } from '@web-relay/protocol';
import type { Snapshot } from './model';
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
let snapshot: Snapshot | undefined;
let commands: CapabilityDescriptor[] = [];
let selected = 0;
let busy = false;
const search = element<HTMLInputElement>('#search');
const status = element('#status');
async function panel(message: Record<string, unknown>): Promise<unknown> {
  const result: unknown = await bounded(chrome.runtime.sendMessage({ channel: 'web-relay:panel', version: 1, ...message }), 10000);
  if (!record(result) || result.ok !== true) throw new Error(record(result) && record(result.error) && typeof result.error.message === 'string' ? result.error.message : 'Launcher request failed.');
  return result.data;
}
function report(error: unknown) { status.textContent = error instanceof Error ? error.message : 'The action failed.'; }
function render() {
  const query = search.value.toLowerCase().trim();
  commands = (snapshot?.capabilities || []).filter(command => `${command.title} ${command.description || ''} ${command.providerId}`.toLowerCase().includes(query));
  selected = Math.min(selected, Math.max(0, commands.length - 1));
  const list = element('#commands'); list.replaceChildren();
  commands.forEach((command, index) => {
    const button = document.createElement('button');
    button.className = 'command' + (index === selected ? ' selected' : '');
    button.disabled = busy;
    const title = document.createElement('span'); title.textContent = command.title;
    const source = document.createElement('small'); source.textContent = command.providerId;
    button.append(title, source);
    button.addEventListener('click', () => { void run(command); });
    list.append(button);
  });
  if (!commands.length) { const empty = document.createElement('p'); empty.textContent = 'No matching commands.'; list.append(empty); }
}
function apply(value: unknown) {
  snapshot = value as Snapshot;
  const sources = element('#sources'); sources.replaceChildren();
  for (const source of snapshot.sources) {
    const row = document.createElement('p'); row.className = `source ${source.status}`;
    row.textContent = `${source.name} · ${source.status}`; row.title = source.detail; sources.append(row);
  }
  element('#context').textContent = snapshot.context ? new URL(snapshot.context.url).hostname || snapshot.context.url : 'No active page context';
  element<HTMLInputElement>('#github-enabled').checked = !snapshot.sources.some(source => source.name === 'GitHub provider' && source.status === 'disabled');
  render();
}
async function refresh() {
  if (busy) return;
  busy = true; render(); status.textContent = 'Discovering capabilities…';
  try { apply(await panel({ type: 'list' })); status.textContent = `${snapshot!.capabilities.length} commands available`; }
  catch (error) { snapshot = undefined; render(); report(error); }
  finally { busy = false; render(); }
}
async function run(command: CapabilityDescriptor) {
  if (busy) return;
  busy = true; render(); status.textContent = `Running ${command.title}…`;
  try {
    const result = await panel({ type: 'execute', command, context: snapshot?.context });
    if (record(result) && typeof result.clipboard === 'string') await navigator.clipboard.writeText(result.clipboard);
    const message = record(result) && typeof result.message === 'string' ? result.message : 'Action completed.';
    apply(await panel({ type: 'list' })); status.textContent = message;
  } catch (error) { report(error); }
  finally { busy = false; render(); }
}
search.addEventListener('input', () => { selected = 0; render(); });
search.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); selected = Math.max(0, Math.min(commands.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); render();
    element('#commands').children[selected]?.scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter' && commands[selected]) { event.preventDefault(); void run(commands[selected]!); }
  if (event.key === 'Escape') window.close();
});
element('#refresh').addEventListener('click', () => { void refresh(); });
element<HTMLInputElement>('#github-enabled').addEventListener('change', async event => {
  if (busy) { element<HTMLInputElement>('#github-enabled').checked = !element<HTMLInputElement>('#github-enabled').checked; return; }
  busy = true; render();
  try { apply(await panel({ type: 'configure', githubEnabled: (event.target as HTMLInputElement).checked })); status.textContent = 'Provider preference saved.'; }
  catch (error) { report(error); }
  finally { busy = false; render(); }
});
void refresh(); search.focus();
