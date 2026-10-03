import { CapabilityError } from '@web-relay/core';
import type { CapabilityDescriptor, JsonValue } from '@web-relay/core';
export { LAUNCHER_ID, GITHUB_PROVIDER_ID, LLM_PROVIDER_ID } from './identities';
export const CHANNEL = 'web-relay' as const;
export const VERSION = 1 as const;
export const PWA_ORIGINS = ['http://localhost:4173', 'http://127.0.0.1:4173'];
export const TIMEOUT_MS = 3000;
export interface TabContext { tabId: number; url: string }
export interface Request {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  requestId: string;
  type: 'describe' | 'discover' | 'execute';
  providerId?: string;
  capabilityId?: string;
  input?: string;
  context?: TabContext;
}
export type Response = {
  channel: typeof CHANNEL; version: typeof VERSION; requestId: string; type: 'result';
} & ({ ok: true; data: JsonValue } | { ok: false; error: { code: string; message: string } });
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const shortString = (value: unknown, max = 120): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export function isContext(value: unknown): value is TabContext {
  return record(value) && Number.isInteger(value.tabId) && (value.tabId as number) >= 0 && shortString(value.url, 8192);
}
export function isRequest(value: unknown): value is Request {
  return record(value) && value.channel === CHANNEL && value.version === VERSION && shortString(value.requestId, 80)
    && (value.type === 'describe' || value.type === 'discover' || value.type === 'execute')
    && (value.providerId === undefined || (shortString(value.providerId, 80) && /^[a-z][a-z0-9.-]*$/.test(value.providerId)))
    && (value.input === undefined || shortString(value.input, 2000))
    && (value.context === undefined || isContext(value.context))
    && (value.type !== 'execute' || (shortString(value.capabilityId, 80) && /^[a-z][a-z0-9.-]*$/.test(value.capabilityId)));
}
export function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => isJson(item, depth + 1));
  return record(value) && Object.keys(value).length <= 100 && Object.values(value).every(item => isJson(item, depth + 1));
}
export function isResponse(value: unknown): value is Response {
  return record(value) && value.channel === CHANNEL && value.version === VERSION && value.type === 'result' && shortString(value.requestId, 80)
    && (value.ok === true ? isJson(value.data) : value.ok === false && record(value.error) && shortString(value.error.code) && shortString(value.error.message, 500));
}
export function request(type: Request['type'], capabilityId?: string, context?: TabContext, input?: string): Request {
  return { channel: CHANNEL, version: VERSION, requestId: crypto.randomUUID(), type, ...(capabilityId ? { capabilityId } : {}), ...(context ? { context } : {}), ...(input !== undefined ? { input } : {}) };
}
export function success(req: Request, data: JsonValue): Response {
  if (!isJson(data)) throw new CapabilityError('INVALID_RESULT', 'Provider returned a non-JSON result.');
  return { channel: CHANNEL, version: VERSION, requestId: req.requestId, type: 'result', ok: true, data };
}
export function failure(req: Request, error: unknown): Response {
  return { channel: CHANNEL, version: VERSION, requestId: req.requestId, type: 'result', ok: false, error: {
    code: error instanceof CapabilityError ? error.code : 'EXECUTION_FAILED',
    message: (error instanceof Error ? error.message : 'The action failed.').slice(0, 500) || 'The action failed.',
  } };
}
export function unwrap(value: unknown, req: Request): JsonValue {
  if (req.type === 'execute' && (value === undefined || value === null)) return { message: 'Action sent; no result returned.' };
  if (!isResponse(value) || value.requestId !== req.requestId) throw new CapabilityError('INVALID_RESPONSE', 'Invalid or mismatched provider response.');
  if (!value.ok) throw new CapabilityError(value.error.code, value.error.message);
  return value.data;
}
export function descriptors(value: unknown, providerId: string, providerKind: CapabilityDescriptor['providerKind']): CapabilityDescriptor[] {
  if (!Array.isArray(value) || value.length > 50) throw new CapabilityError('INVALID_RESPONSE', 'Invalid capability list.');
  const seen = new Set<string>();
  return value.map(item => {
    if (!record(item) || !shortString(item.id, 80) || !/^[a-z][a-z0-9.-]*$/.test(item.id) || seen.has(item.id)
      || !shortString(item.title) || item.providerId !== providerId || item.providerKind !== providerKind
      || (item.input !== undefined && item.input !== 'text')
      || (item.description !== undefined && !shortString(item.description, 300))) {
      throw new CapabilityError('INVALID_RESPONSE', 'Invalid or duplicate capability metadata.');
    }
    seen.add(item.id);
    return { id: item.id, title: item.title, providerId, providerKind, ...(item.input ? { input: 'text' as const } : {}), ...(item.description ? { description: item.description as string } : {}) };
  });
}
export async function bounded<T>(promise: Promise<T>, timeout = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CapabilityError('TIMEOUT', 'Provider did not respond in time. The action may have completed; check before retrying.')), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
export function isPwaOrigin(url: string): boolean {
  try { return PWA_ORIGINS.includes(new URL(url).origin); } catch { return false; }
}
