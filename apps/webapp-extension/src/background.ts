import { CapabilityError } from '@web-relay/core';
import type { JsonValue } from '@web-relay/core';
import { failure, isRequest, LAUNCHER_ID, success } from '@web-relay/protocol';
import { githubRegistry } from './github';

chrome.runtime.onMessageExternal.addListener((value: unknown, sender, sendResponse) => {
  if (sender.id !== LAUNCHER_ID || !isRequest(value)) return;
  (async () => {
    if (value.context) {
      const tab = await chrome.tabs.get(value.context.tabId);
      if (!tab.active || tab.url !== value.context.url) throw new CapabilityError('STALE_CONTEXT', 'The active page changed. Refresh the launcher.');
    }
    const registry = githubRegistry(() => value.context, async (url, tabId) => {
      if (tabId === undefined) await chrome.tabs.create({ url });
      else await chrome.tabs.update(tabId, { url });
    });
    const data = value.type === 'discover' ? registry.list() as unknown as JsonValue : await registry.execute(value.capabilityId!, value.input);
    return success(value, data);
  })().then(sendResponse, error => sendResponse(failure(value, error)));
  return true;
});
