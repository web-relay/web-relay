export type ProviderKind = 'pwa' | 'extension' | 'browser';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface CapabilityDescriptor {
  id: string;
  title: string;
  description?: string;
  providerId: string;
  providerKind: ProviderKind;
}
export interface Capability<C> {
  id: string;
  title: string;
  description?: string;
  when?: (context: C) => boolean;
  run: (context: C) => JsonValue | Promise<JsonValue>;
}
export class CapabilityError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
/** Functions and live context remain in the owning provider. */
export class Registry<C> {
  private readonly commands = new Map<string, Capability<C>>();
  constructor(readonly providerId: string, readonly providerKind: ProviderKind, private readonly context: () => C) {}
  register(command: Capability<C>): () => void {
    if (!/^[a-z][a-z0-9.-]{0,79}$/.test(command.id) || !command.title.trim() || command.title.length > 120) {
      throw new CapabilityError('INVALID_CAPABILITY', 'Invalid capability metadata.');
    }
    if (this.commands.has(command.id)) throw new CapabilityError('DUPLICATE_ID', `Already registered: ${command.id}`);
    // Copy registration metadata so callers cannot mutate the registry through their object.
    const registered = { ...command };
    this.commands.set(command.id, registered);
    return () => { if (this.commands.get(command.id) === registered) this.commands.delete(command.id); };
  }
  list(): CapabilityDescriptor[] {
    const context = this.context();
    return [...this.commands.values()].filter(command => !command.when || command.when(context)).map(({ id, title, description }) => ({
      id, title, ...(description ? { description } : {}), providerId: this.providerId, providerKind: this.providerKind,
    }));
  }
  async execute(id: string): Promise<JsonValue> {
    const command = this.commands.get(id);
    if (!command) throw new CapabilityError('NOT_FOUND', 'Capability is no longer registered.');
    const context = this.context();
    if (command.when && !command.when(context)) throw new CapabilityError('UNAVAILABLE', 'This action is no longer available. Refresh the launcher.');
    return command.run(context);
  }
}
