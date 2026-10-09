import { mountLauncher } from './panel';
import html from '../public/popup.html';
import css from '../public/popup.css';

const world = globalThis as typeof globalThis & { __webRelayClose?: () => void };
if (world.__webRelayClose) world.__webRelayClose();
else {
  const previousFocus = document.activeElement;
  const host = document.createElement('web-relay-launcher');
  host.setAttribute('data-web-relay', 'launcher');
  const root = host.attachShadow({ mode: 'open' });
  const backdrop = document.createElement('div'); backdrop.className = 'backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'panel'; dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-label','Web Relay Launcher'); dialog.setAttribute('aria-modal','true');
  // Bundled static template only; provider metadata and results use textContent.
  dialog.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css.replaceAll(':root', ':host').replace('body{', '.panel{') + `
    :host{all:initial;position:fixed;inset:0;z-index:2147483647;display:block;color-scheme:light dark}
    .backdrop{position:absolute;inset:0;background:#10271d66;display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 20px;overflow:auto}
    .panel{width:460px;max-width:100%;border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 80px #0004;background:var(--surface);color:var(--text);padding:22px;font:14px/1.5 system-ui}
    @media(max-height:650px){.backdrop{padding-top:24px}#commands{max-height:240px}}
  `);
  root.adoptedStyleSheets = [sheet]; backdrop.append(dialog); root.append(backdrop);
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && typeof message === 'object' && message !== null && (message as Record<string, unknown>).channel === 'web-relay:ui' && (message as Record<string, unknown>).type === 'dismiss') close();
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    host.remove(); delete world.__webRelayClose;
    window.removeEventListener('blur', close);
    chrome.runtime.onMessage.removeListener(onMessage);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  world.__webRelayClose = close;
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  root.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    key.stopPropagation();
    if (key.key === 'Escape') { key.preventDefault(); close(); }
    if (key.key === 'Tab') {
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')].filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (key.shiftKey && root.activeElement === first) { key.preventDefault(); last?.focus(); }
      else if (!key.shiftKey && root.activeElement === last) { key.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('blur', close);
  chrome.runtime.onMessage.addListener(onMessage);
  document.documentElement.append(host);
  mountLauncher(root, close);
}
