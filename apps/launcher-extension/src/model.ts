import type { CapabilityDescriptor } from '@web-relay/core';
import type { TabContext } from '@web-relay/protocol';
export interface SourceStatus { name: string; status: 'connected' | 'unavailable' | 'disabled'; detail: string }
export interface Snapshot { context?: TabContext; capabilities: CapabilityDescriptor[]; sources: SourceStatus[] }
