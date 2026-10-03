/** Initial shared data types. The registry and execution API are still to be designed. */
export type ProviderKind = 'pwa' | 'extension' | 'browser';

export interface CapabilityDescriptor {
  id: string;
  title: string;
  description?: string;
  providerId: string;
  providerKind: ProviderKind;
}
