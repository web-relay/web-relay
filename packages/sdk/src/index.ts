import { Registry } from '@web-relay/core';
import { failure, isRequest, success } from '@web-relay/protocol';
import type { JsonValue } from '@web-relay/core';

export function createLauncher<C>(options: { providerId: string; context: () => C; onInvocation?: () => void }) {
  const registry = new Registry(options.providerId, 'pwa', options.context);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data !== 'object' || event.data === null) return;
    const envelope = event.data as Record<string, unknown>;
    if (envelope.source !== 'web-relay:extension' || !isRequest(envelope.message)) return;
    const req = envelope.message;
    options.onInvocation?.();
    const operation = Promise.resolve().then(() => req.type === 'discover'
      ? registry.list() as unknown as JsonValue
      : registry.execute(req.capabilityId!, req.input));
    operation.then(data => success(req, data), error => failure(req, error)).catch(error => failure(req, error)).then(message => {
      window.postMessage({ source: 'web-relay:pwa', message }, location.origin);
    });
  };
  window.addEventListener('message', onMessage);
  return { registry, dispose: () => window.removeEventListener('message', onMessage) };
}
