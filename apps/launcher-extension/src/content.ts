import { failure, isRequest, isResponse } from '@web-relay/protocol';
import { CapabilityError } from '@web-relay/core';
import type { Response } from '@web-relay/protocol';
const bridge = globalThis as typeof globalThis & { webRelayBridgeInstalled?: boolean };

if (window === window.top && !bridge.webRelayBridgeInstalled) {
  bridge.webRelayBridgeInstalled = true;
  const pending = new Map<string, { finish: (response: Response) => void; timer: ReturnType<typeof setTimeout> }>();
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data !== 'object' || event.data === null) return;
    const envelope = event.data as Record<string, unknown>;
    if (envelope.source !== 'web-relay:pwa' || !isResponse(envelope.message)) return;
    const entry = pending.get(envelope.message.requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(envelope.message.requestId);
    entry.finish(envelope.message);
  });
  chrome.runtime.onMessage.addListener((value: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isRequest(value)) return;
    if (value.context && value.context.url !== location.href) {
      sendResponse(failure(value, new CapabilityError('STALE_CONTEXT', 'The page changed. Refresh the launcher.'))); return;
    }
    const timer = setTimeout(() => {
      pending.delete(value.requestId);
      sendResponse(failure(value, new CapabilityError('TIMEOUT', 'The app did not respond. Check the page before retrying.')));
    }, 2500);
    pending.set(value.requestId, { finish: sendResponse, timer });
    window.postMessage({ source: 'web-relay:extension', message: value }, location.origin);
    return true;
  });
}
