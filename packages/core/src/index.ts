export type ProviderKind = 'pwa' | 'extension' | 'browser';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface CapabilityDescriptor {
  id: string;
  title: string;
  description?: string;
  input?: 'text';
  providerId: string;
  providerKind: ProviderKind;
}
export interface Capability<C> {
  id: string;
  title: string;
  description?: string;
  input?: 'text';
  when?: (context: C) => boolean;
  run: (context: C, input?: string) => JsonValue | void | Promise<JsonValue | void>;
}
export class CapabilityError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
/** Functions and live context remain in the owning provider. */
export class Registry<C> {
  private readonly commands = new Map<string, Capability<C>>();
  constructor(readonly providerId: string, readonly providerKind: ProviderKind, private readonly context: () => C) {
    if (typeof providerId !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(providerId) || !['pwa','extension','browser'].includes(providerKind)) {
      throw new CapabilityError('INVALID_PROVIDER', 'Provider ID must start with a lowercase letter and contain at most 80 lowercase letters, digits, dots or hyphens.');
    }
  }
  register(command: Capability<C>): () => void {
    if (typeof command.id !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(command.id)
      || typeof command.title !== 'string' || !command.title.trim() || command.title.length > 120
      || (command.description !== undefined && (typeof command.description !== 'string' || !command.description.trim() || command.description.length > 300))
      || (command.input !== undefined && command.input !== 'text') || typeof command.run !== 'function'
      || (command.when !== undefined && typeof command.when !== 'function')) {
      throw new CapabilityError('INVALID_CAPABILITY', 'Use an ID of 1–80 lowercase letters, digits, dots or hyphens, a title of 1–120 characters, a description of 1–300 characters, and input: text or no input.');
    }
    if (this.commands.has(command.id)) throw new CapabilityError('DUPLICATE_ID', `Already registered: ${command.id}`);
    if (this.providerKind !== 'browser' && this.commands.size >= 50) throw new CapabilityError('CAPABILITY_LIMIT', 'A provider may register at most 50 commands. Unregister a command before adding another.');
    // Copy registration metadata so callers cannot mutate the registry through their object.
    const registered = { ...command };
    this.commands.set(command.id, registered);
    return () => { if (this.commands.get(command.id) === registered) this.commands.delete(command.id); };
  }
  list(): CapabilityDescriptor[] {
    const context = this.context();
    return [...this.commands.values()].filter(command => !command.when || command.when(context)).map(({ id, title, description, input }) => ({
      id, title, ...(input ? { input } : {}), ...(description ? { description } : {}), providerId: this.providerId, providerKind: this.providerKind,
    }));
  }
  async execute(id: string, input?: string): Promise<JsonValue> {
    const command = this.commands.get(id);
    if (!command) throw new CapabilityError('NOT_FOUND', 'Capability is no longer registered.');
    if (command.input === 'text' && (typeof input !== 'string' || !input.trim() || input.length > 2000)) throw new CapabilityError('INVALID_INPUT', 'Enter a question of 1–2000 characters.');
    if (command.input !== 'text' && input !== undefined) throw new CapabilityError('INVALID_INPUT', 'This command does not accept input.');
    const context = this.context();
    if (command.when && !command.when(context)) throw new CapabilityError('UNAVAILABLE', 'This action is no longer available. Refresh the launcher.');
    return (await command.run(context, input)) ?? null;
  }
}
