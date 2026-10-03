import type { CapabilityDescriptor } from '@web-relay/core';
import { bounded, record } from '@web-relay/protocol';
import type { Snapshot } from './model';

export function mountLauncher(root: Document | ShadowRoot, close: () => void): void {
const element = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
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
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  commands = (snapshot?.capabilities || []).filter(command => {
    const text = `${command.title} ${command.description || ''} ${command.providerId}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  selected = Math.min(selected, Math.max(0, commands.length - 1));
  const list = element('#commands'); list.replaceChildren();
  commands.forEach((command, index) => {
    const button = document.createElement('button');
    button.className = 'command' + (index === selected ? ' selected' : '');
    button.disabled = busy;
    const title = document.createElement('span'); title.textContent = command.title;
    const source = document.createElement('small'); source.textContent = command.providerId;
    button.append(title, source);
    button.addEventListener('click', event => { if (event.isTrusted) void run(command); });
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
let inputCommand: CapabilityDescriptor | undefined;
async function copy(text: string) {
  // Clipboard permission is extension-scoped; execCommand covers non-secure HTTP pages.
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return; } } catch {}
  const textarea = document.createElement('textarea');
  textarea.value = text; textarea.style.cssText = 'position:fixed;opacity:0;';
  root.querySelector('#status')!.append(textarea); textarea.focus(); textarea.select();
  const copied = document.execCommand('copy'); textarea.remove();
  if (!copied) throw new Error('Could not copy. Keep the launcher open and try again.');
}
function showQuestion(command: CapabilityDescriptor) {
  inputCommand = command;
  element('#question-form').hidden = false;
  element('#commands').hidden = true;
  element('#search').hidden = true;
  element('#question-title').textContent = command.title;
  element<HTMLTextAreaElement>('#question').value = '';
  element('#question').focus();
  status.textContent = 'Enter the text to send to this capability.';
}
function cancelQuestion() {
  inputCommand = undefined;
  element('#question-form').hidden = true;
  element('#commands').hidden = false;
  element('#search').hidden = false;
  search.focus();
}
element('#question-form').addEventListener('submit', event => { event.preventDefault(); });
element('#question-send').addEventListener('click', event => {
  if (event.isTrusted && inputCommand) void run(inputCommand, element<HTMLTextAreaElement>('#question').value);
});
element('#question-cancel').addEventListener('click', cancelQuestion);
async function run(command: CapabilityDescriptor, input?: string) {
  if (busy) return;
  if (command.input === 'text' && input === undefined) { showQuestion(command); return; }
  busy = true; render(); status.textContent = `Running ${command.title}…`;
  try {
    const result = await panel({ type: 'execute', command, context: snapshot?.context, ...(input !== undefined ? { input } : {}) });
    if (root instanceof ShadowRoot && !root.host.isConnected) return;
    if (record(result) && typeof result.clipboard === 'string') await copy(result.clipboard);
    const message = record(result) && typeof result.message === 'string' ? result.message : 'Action delivered.';
    status.textContent = message;
    if (record(result) && typeof result.openUrl === 'string') {
      await panel({ type: 'open-handoff', url: result.openUrl });
      close(); return;
    }
    cancelQuestion();
    // Discovery failure must not turn an already delivered action into an execution error.
    try { apply(await panel({ type: 'list' })); status.textContent = message; }
    catch { status.textContent = `${message} Refresh to reload commands.`; }
  } catch (error) { report(error); }
  finally { busy = false; render(); }
}
search.addEventListener('input', () => { selected = 0; render(); });
search.addEventListener('keydown', event => {
  if (!event.isTrusted) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); selected = Math.max(0, Math.min(commands.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); render();
    element('#commands').children[selected]?.scrollIntoView({ block: 'nearest' });
  }
  if (event.key === 'Enter' && commands[selected]) { event.preventDefault(); void run(commands[selected]!); }
  if (event.key === 'Escape') close();
});
element('#provider-settings').addEventListener('click', async event => {
  if (!event.isTrusted) return;
  try { await panel({type:'open-settings'}); close(); } catch (error) { report(error); }
});
element('#refresh').addEventListener('click', () => { void refresh(); });
element<HTMLInputElement>('#github-enabled').addEventListener('click', async event => {
  if (!event.isTrusted) return;
  if (busy) { element<HTMLInputElement>('#github-enabled').checked = !element<HTMLInputElement>('#github-enabled').checked; return; }
  busy = true; render();
  try { apply(await panel({ type: 'configure', githubEnabled: (event.target as HTMLInputElement).checked })); status.textContent = 'Provider preference saved.'; }
  catch (error) { report(error); }
  finally { busy = false; render(); }
});
void refresh(); search.focus();
}
