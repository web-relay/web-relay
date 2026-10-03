import { CapabilityError } from '@web-relay/core';
import { bounded, descriptors, record, request, unwrap, VERSION } from '@web-relay/protocol';
import { extensionProviders } from './providers';
import type { ExtensionProvider } from './providers';

export interface SavedProvider {
  providerId: string;
  name: string;
  extensionId: string;
  enabled: boolean;
  shareTabContext: boolean;
}
interface Identity { providerId: string; name: string; protocolVersion: number }
const KEY = 'pairedExtensionProviders';
const PROPOSAL = 'extensionPairingProposal';
const providerIdPattern = /^[a-z][a-z0-9.-]{0,79}$/;
const extensionIdPattern = /^[a-p]{32}$/;
const reserved = new Set(['browser', 'tabs', 'demo-notes', ...extensionProviders.map(provider => provider.providerId)]);
const label = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 120;

export function savedProviders(value: unknown): SavedProvider[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new CapabilityError('INVALID_SETTINGS', 'Invalid saved provider settings.');
  const ids = new Set<string>(), extensions = new Set<string>();
  return value.map(item => {
    if (!record(item) || typeof item.providerId !== 'string' || !providerIdPattern.test(item.providerId)
      || reserved.has(item.providerId) || !label(item.name) || typeof item.extensionId !== 'string'
      || !extensionIdPattern.test(item.extensionId) || extensionProviders.some(provider => provider.extensionId === item.extensionId)
      || typeof item.enabled !== 'boolean' || typeof item.shareTabContext !== 'boolean'
      || ids.has(item.providerId) || extensions.has(item.extensionId)) {
      throw new CapabilityError('INVALID_SETTINGS', 'Invalid or duplicate saved provider.');
    }
    ids.add(item.providerId); extensions.add(item.extensionId);
    return {providerId:item.providerId,name:item.name,extensionId:item.extensionId,enabled:item.enabled,shareTabContext:item.shareTabContext};
  });
}
export async function loadSavedProviders(): Promise<SavedProvider[]> {
  return savedProviders((await chrome.storage.local.get(KEY))[KEY]);
}
export async function allExtensionProviders(): Promise<ExtensionProvider[]> {
  return [...extensionProviders, ...(await loadSavedProviders()).map(provider => ({
    providerId:provider.providerId, name:provider.name, extensionId:provider.extensionId, enabled:provider.enabled,
    ...(provider.shareTabContext ? {} : {contextOrigins:[]}),
  }))];
}
function checkExtensionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !extensionIdPattern.test(value)) throw new CapabilityError('INVALID_PROVIDER', 'Enter the 32-letter extension ID from chrome://extensions.');
  if (value === chrome.runtime.id) throw new CapabilityError('INVALID_PROVIDER', 'Choose a provider extension, not the launcher.');
}
function identity(value: unknown): Identity {
  if (!record(value) || typeof value.providerId !== 'string' || !providerIdPattern.test(value.providerId)
    || !label(value.name) || value.protocolVersion !== VERSION) {
    throw new CapabilityError('INVALID_RESPONSE', 'Provider returned an invalid identity or incompatible protocol version.');
  }
  return {providerId:value.providerId,name:value.name,protocolVersion:VERSION};
}
async function probe(extensionId: string): Promise<Identity> {
  const describe = request('describe');
  let value;
  try { value = await bounded(chrome.runtime.sendMessage(extensionId, describe)); }
  catch { /* Older SDKs ignore describe; try their existing discovery contract. */ }
  if (value !== undefined && value !== null) return identity(unwrap(value, describe));
  const discover = request('discover');
  try {
    const commands = unwrap(await bounded(chrome.runtime.sendMessage(extensionId, discover)), discover);
    if (!Array.isArray(commands) || !record(commands[0])) {
      throw new CapabilityError('EMPTY_PROVIDER', 'No commands to identify this provider. Upgrade it to SDK 0.1.3, or enable a command first.');
    }
    const result = identity({providerId:commands[0].providerId,name:commands[0].providerId,protocolVersion:VERSION});
    descriptors(commands, result.providerId, 'extension');
    return result;
  } catch (error) {
    if (error instanceof CapabilityError && error.code !== 'TIMEOUT') throw error;
    throw new CapabilityError('PAIRING_FAILED', 'Cannot connect. Load the provider and make sure its launcherId and externally_connectable.ids allow this launcher.');
  }
}
async function noCollision(providers: SavedProvider[], extensionId: string, providerId: string) {
  const pwas = (await chrome.storage.local.get('pairedPwaProviders')).pairedPwaProviders;
  if ((Array.isArray(pwas) && pwas.some(p=>p.providerId === providerId)) || reserved.has(providerId) || extensionProviders.some(provider => provider.extensionId === extensionId)
    || providers.some(provider => provider.providerId === providerId || provider.extensionId === extensionId)) {
    throw new CapabilityError('ALREADY_PAIRED', 'That extension or provider ID is already paired or reserved.');
  }
  if (providers.length >= 20) throw new CapabilityError('PAIRING_LIMIT', 'Remove a provider before adding another (maximum 20).');
}
// Serialize storage changes so overlapping settings pages cannot overwrite approval/removal.
let changes: Promise<unknown> = Promise.resolve();
export function updatePairings<T>(run: () => Promise<T>): Promise<T> {
  const next = changes.then(run, run);
  changes = next.catch(() => {});
  return next;
}
export async function checkPairing(extensionId: unknown, owner: string) {
  checkExtensionId(extensionId);
  const info = await probe(extensionId);
  await noCollision(await loadSavedProviders(), extensionId, info.providerId);
  const proposal = {...info,extensionId,token:crypto.randomUUID(),owner,expires:Date.now()+5*60*1000};
  await chrome.storage.session.set({[PROPOSAL]:proposal});
  return {providerId:info.providerId,name:info.name,protocolVersion:info.protocolVersion,extensionId,token:proposal.token};
}
export function approvePairing(token: unknown, shareTabContext: unknown, owner: string) {
  return updatePairings(async () => {
    const pending = (await chrome.storage.session.get(PROPOSAL))[PROPOSAL];
    if (!record(pending) || typeof token !== 'string' || pending.token !== token || pending.owner !== owner
      || typeof pending.expires !== 'number' || pending.expires < Date.now() || typeof shareTabContext !== 'boolean') {
      throw new CapabilityError('APPROVAL_REQUIRED', 'Check the provider connection again before approving pairing.');
    }
    checkExtensionId(pending.extensionId);
    const info = await probe(pending.extensionId);
    if (info.providerId !== pending.providerId || info.name !== pending.name || info.protocolVersion !== pending.protocolVersion) {
      throw new CapabilityError('IDENTITY_CHANGED', 'Provider identity changed. Check the connection again.');
    }
    const providers = await loadSavedProviders();
    await noCollision(providers,pending.extensionId,info.providerId);
    providers.push({providerId:info.providerId,name:info.name,extensionId:pending.extensionId,enabled:true,shareTabContext});
    await chrome.storage.local.set({[KEY]:providers});
    await chrome.storage.session.remove(PROPOSAL);
    return providers;
  });
}
export function changePairing(extensionId: unknown, enabled?: boolean) {
  return updatePairings(async () => {
    checkExtensionId(extensionId);
    const providers = await loadSavedProviders();
    const selected = providers.find(provider=>provider.extensionId === extensionId);
    if (!selected) throw new CapabilityError('NOT_FOUND', 'This saved pairing no longer exists.');
    const next = enabled === undefined ? providers.filter(provider=>provider !== selected)
      : providers.map(provider=>provider === selected ? {...provider,enabled} : provider);
    await chrome.storage.local.set({[KEY]:next});
    return next;
  });
}
