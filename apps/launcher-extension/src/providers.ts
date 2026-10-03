import { GITHUB_PROVIDER_ID, LLM_PROVIDER_ID } from '@web-relay/protocol';

/** Explicit local pairing. Edit these entries, then rebuild/reload the launcher. */
export interface ExtensionProvider {
  providerId: string;
  name: string;
  extensionId: string;
  contextOrigins?: string[];
  enabledSetting?: string;
}
export const extensionProviders: ExtensionProvider[] = [
  { providerId:'github', name:'GitHub provider', extensionId:GITHUB_PROVIDER_ID, contextOrigins:['https://github.com'], enabledSetting:'githubEnabled' },
  { providerId:'llm', name:'LLM provider', extensionId:LLM_PROVIDER_ID },
];
export const pwaProviders = [
  { providerId:'demo-notes', name:'Notes PWA', origins:['http://localhost:4173','http://127.0.0.1:4173'] },
];
export function pwaProvider(url: string) {
  try { const origin = new URL(url).origin; return pwaProviders.find(provider=>provider.origins.includes(origin)); }
  catch { return undefined; }
}
