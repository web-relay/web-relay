import { CapabilityError, Registry } from '@web-relay/core';
import { failure, isRequest, success, VERSION } from '@web-relay/protocol';
import type { JsonValue } from '@web-relay/core';

export function createLauncher<C>(options: { providerId: string; name?: string; context: () => C; onInvocation?: () => void }) {
  if (options.name !== undefined && (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 120)) throw new CapabilityError('INVALID_PROVIDER','Provider name must be nonblank and at most 120 characters.');
  const registry = new Registry(options.providerId, 'pwa', options.context);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data !== 'object' || event.data === null) return;
    const envelope = event.data as Record<string, unknown>;
    if (envelope.source !== 'web-relay:extension' || !isRequest(envelope.message)) return;
    const req = envelope.message;
    if (req.providerId !== undefined && req.providerId !== options.providerId) return;
    options.onInvocation?.();
    const operation = Promise.resolve().then(() => {
      if (req.type === 'describe') return {providerId:options.providerId,name:options.name ?? options.providerId,protocolVersion:VERSION};
      return req.type === 'discover' ? registry.list() as unknown as JsonValue : registry.execute(req.capabilityId!, req.input);
    });
    operation.then(data => success(req, data), error => failure(req, error)).catch(error => failure(req, error)).then(message => {
      window.postMessage({ source: 'web-relay:pwa', message }, location.origin);
    });
  };
  window.addEventListener('message', onMessage);
  return { registry, dispose: () => window.removeEventListener('message', onMessage) };
}

export { CapabilityError, Registry } from '@web-relay/core';
export type { Capability, CapabilityDescriptor, JsonValue, ProviderKind } from '@web-relay/core';
