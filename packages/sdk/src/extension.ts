import { CapabilityError, Registry } from '@web-relay/core';
import type { JsonValue } from '@web-relay/core';
import { failure, isRequest, success } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';

/** Serve a separately installed provider using the shared capability contract. */
export function createExtensionProvider(options: {
  providerId: string;
  launcherId: string;
  register: (registry: Registry<TabContext | undefined>) => void;
}) {
  const listener: Parameters<typeof chrome.runtime.onMessageExternal.addListener>[0] = (value: unknown, sender, respond) => {
    if (sender.id !== options.launcherId || !isRequest(value)) return;
    (async () => {
      if (value.context) {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (active?.id !== value.context.tabId || active.url !== value.context.url) {
          throw new CapabilityError('STALE_CONTEXT', 'The active page changed. Reopen the launcher.');
        }
      }
      const registry = new Registry(options.providerId, 'extension', () => value.context);
      options.register(registry);
      return success(value, value.type === 'discover'
        ? registry.list() as unknown as JsonValue
        : await registry.execute(value.capabilityId!, value.input));
    })().then(respond, error => respond(failure(value, error)));
    return true;
  };
  chrome.runtime.onMessageExternal.addListener(listener);
  return { dispose: () => chrome.runtime.onMessageExternal.removeListener(listener) };
}

export { LAUNCHER_ID } from '@web-relay/protocol';
export type { TabContext } from '@web-relay/protocol';
export { CapabilityError } from '@web-relay/core';
export type { JsonValue } from '@web-relay/core';
