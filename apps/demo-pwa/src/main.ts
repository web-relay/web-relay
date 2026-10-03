import { createLauncher } from '@web-relay/sdk';
interface Note { id: string; title: string; pinned: boolean }
function loadNotes(): Note[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('web-relay-notes') || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((note): note is Note => typeof note === 'object' && note !== null && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.pinned === 'boolean');
  } catch { return []; }
}
const notes = loadNotes();
let selectedId: string | undefined;
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const status = element('#status');
const { registry } = createLauncher({ providerId: 'demo-notes', context: () => ({ selectedId }), onInvocation: () => {
  element('#bridge-status').textContent = 'Launcher connected · last request ' + new Date().toLocaleTimeString();
} });
function save() {
  localStorage.setItem('web-relay-notes', JSON.stringify(notes));
  render();
}
registry.register({ id: 'notes.create', title: 'Create note', description: 'Create a note in the local demo PWA', run: () => {
  const note = { id: crypto.randomUUID(), title: `Note ${notes.length + 1}`, pinned: false };
  notes.push(note); selectedId = note.id; save();
  status.textContent = `Created ${note.title}.`;
  return { message: `Created ${note.title}.` };
} });
registry.register({ id: 'notes.pin-selected', title: 'Pin selected note', description: 'Available when an unpinned note is selected',
  when: ({ selectedId }) => notes.some(note => note.id === selectedId && !note.pinned),
  run: ({ selectedId }) => {
    const note = notes.find(note => note.id === selectedId)!;
    note.pinned = true; save(); status.textContent = `Pinned ${note.title}.`;
    return { message: `Pinned ${note.title}.` };
  },
});
function render() {
  const list = element('#notes'); list.replaceChildren();
  element('#empty').hidden = notes.length > 0;
  for (const note of notes) {
    const button = document.createElement('button');
    button.className = 'note';
    button.textContent = `${note.pinned ? '★ ' : ''}${note.title}`;
    button.setAttribute('aria-pressed', String(selectedId === note.id));
    button.addEventListener('click', () => { selectedId = note.id; render(); });
    list.append(button);
  }
  const palette = element('#commands'); palette.replaceChildren();
  const search = element<HTMLInputElement>('#search').value.toLowerCase();
  for (const command of registry.list().filter(command => command.title.toLowerCase().includes(search))) {
    const button = document.createElement('button');
    button.textContent = command.title; button.className = 'command';
    button.addEventListener('click', () => {
      button.disabled = true;
      registry.execute(command.id).catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : 'Action failed.'; }).finally(render);
    });
    palette.append(button);
  }
}
element('#search').addEventListener('input', render);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); element('#search').focus(); }
});
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      element('#offline-status').textContent = 'Offline support could not start.';
      console.error(error);
    });
    navigator.serviceWorker.ready.then(() => { element('#offline-status').textContent = 'Offline shell ready'; });
  });
}
