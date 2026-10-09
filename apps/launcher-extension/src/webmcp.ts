import { CapabilityError } from '@web-relay/core';
import { bounded, isJson, record } from '@web-relay/protocol';
import type { TabContext } from '@web-relay/protocol';
import type { JsonValue } from '@web-relay/core';

export interface WebMcpCommand {
  id: string;
  title: string;
  description?: string;
  providerId: string;
  siteId?: string;
  sourceName?: string;
  providerKind: 'webmcp';
  input: 'json';
  inputSchema: JsonValue;
  documentId: string;
}

/** Serialized by executeScript: no imports, captured values, or persistent page bridge. */
export async function webMcpPage(expectedUrl: string, name: string | null = null, input: string | null = null, expectedSchema: string | null = null) {
  try {
    if (window !== window.top || location.href !== expectedUrl) throw new Error('The page changed. Refresh the launcher.');
    type Tool = {name: string; title?: string; description?: string; inputSchema?: unknown; origin?: string; window?: Window};
    type Api = {getTools?: () => Promise<Tool[]>; listTools?: () => Tool[]; executeTool: (tool: Tool | string, input: unknown) => Promise<unknown>};
    const doc = document as Document & {modelContext?: Api};
    const nav = navigator as Navigator & {modelContextTesting?: Api};
    const modern = doc.modelContext;
    const api = modern?.getTools && typeof modern.executeTool === 'function' ? modern : nav.modelContextTesting;
    if (!api || typeof api.executeTool !== 'function' || (!api.getTools && !api.listTools)) return {ok: true as const, supported: false, data: []};
    const tools = (api.getTools ? await api.getTools() : api.listTools!()).filter(tool =>
      (!tool.origin || tool.origin === location.origin) && (!tool.window || tool.window === window));
    const schemaOf = (tool: Tool): unknown => typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema ?? {type:'object'};
    if (name === null) return {ok: true as const, supported: true, data: tools.slice(0, 50).map(tool => ({
      name: tool.name, title: tool.title || tool.name, description: tool.description, inputSchema: schemaOf(tool),
    }))};
    const matches = tools.filter(tool => tool.name === name);
    if (matches.length !== 1) throw new Error('The tool is no longer uniquely available. Refresh the launcher.');
    const tool = matches[0]!;
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
    if (JSON.stringify(canonical(schemaOf(tool))) !== JSON.stringify(canonical(JSON.parse(expectedSchema ?? '{}')))) throw new Error('Tool inputs changed. Refresh the launcher.');
    if (location.href !== expectedUrl) throw new Error('The page changed. Refresh the launcher.');
    const args: unknown = JSON.parse(input ?? '{}');
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object.');
    // Chrome 155 changed executeTool to object arguments. Never retry a possibly delivered write.
    const chromeVersion = Number(navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] ?? 0);
    const result = await api.executeTool(api === modern ? tool : name, api === modern && chromeVersion >= 155 ? args : JSON.stringify(args));
    const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
    return {ok: true as const, supported: true, data: (text ?? '').slice(0, 8000)};
  } catch (error) {
    return {ok: false as const, error: error instanceof Error ? error.message.slice(0,500) : 'WebMCP request failed.'};
  }
}

async function call(context: TabContext, name?: string, input?: string, schema?: string, documentId?: string) {
  if (!/^https?:\/\//.test(context.url)) throw new CapabilityError('UNAVAILABLE', 'Open a regular website.');
  const results = await bounded(chrome.scripting.executeScript({
    target: documentId ? {tabId: context.tabId, documentIds:[documentId]} : {tabId: context.tabId, frameIds: [0]}, world: 'MAIN',
    func: webMcpPage, args: [context.url, name ?? null, input ?? null, schema ?? null],
  }), name === undefined ? 3000 : 8000);
  const result = results[0]?.result;
  if (!result || !result.ok) throw new CapabilityError('WEBMCP_FAILED', result?.error ?? 'No WebMCP reply. Delivery is unconfirmed; do not retry writes automatically.');
  return {...result, documentId:results[0]!.documentId};
}
export async function discoverWebMcp(context: TabContext) {
  const result = await call(context);
  const commands: WebMcpCommand[] = [];
  if (Array.isArray(result.data)) for (const tool of result.data) {
    if (!record(tool) || typeof tool.name !== 'string' || !tool.name || tool.name.length > 200 || !record(tool.inputSchema) || !isJson(tool.inputSchema)) continue;
    commands.push({id:tool.name,title:String(tool.title).slice(0,120),description:typeof tool.description === 'string' ? tool.description.slice(0,300) : undefined,
      input:'json',documentId:result.documentId,inputSchema:tool.inputSchema,providerId:'webmcp',providerKind:'webmcp'});
  }
  return {commands, supported:result.supported};
}
export function validateWebMcpInput(input?: string): void {
  if (typeof input !== 'string' || input.length > 2000) throw new CapabilityError('INVALID_INPUT','Enter JSON arguments of at most 2000 characters.');
  let args: unknown;
  try { args = JSON.parse(input); } catch { throw new CapabilityError('INVALID_INPUT','Enter valid JSON arguments.'); }
  if (!record(args)) throw new CapabilityError('INVALID_INPUT','Tool arguments must be a JSON object.');
}
export async function executeWebMcp(command: WebMcpCommand, context: TabContext, input?: string): Promise<JsonValue> {
  validateWebMcpInput(input);
  const result = await call(context, command.id, input, JSON.stringify(command.inputSchema),command.documentId);
  if (!result.supported) throw new CapabilityError('UNAVAILABLE','WebMCP is unavailable on this page.');
  // Page results never become clipboard or navigation instructions to the launcher.
  return {message: typeof result.data === 'string' ? result.data || 'Tool completed.' : 'Tool completed.'};
}
