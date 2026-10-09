import type { CapabilityDescriptor } from '@web-relay/core';
import type { TabContext } from '@web-relay/protocol';
import type { WebMcpCommand } from './webmcp';
export type LauncherCommand = CapabilityDescriptor | WebMcpCommand;
export interface SourceStatus { name: string; status: 'connected' | 'registered' | 'unavailable' | 'disabled'; detail: string }
export interface Snapshot { context?: TabContext; capabilities: LauncherCommand[]; sources: SourceStatus[] }
