import { DEVELOPMENT_STATUS } from '@web-relay/protocol';

const status = document.querySelector<HTMLElement>('#status');
if (status) status.textContent = `Development status: ${DEVELOPMENT_STATUS}. The bridge is not connected yet.`;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('Offline support could not start:', error);
    });
  });
}
