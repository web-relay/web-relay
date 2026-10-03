---
name: web-relay-integration
description: Add or update Web Relay launcher capabilities in an existing Chromium extension or PWA using the Web Relay SDK, including explicit provider pairing and integration verification.
---

# Integrate with Web Relay

Keep the user's app in its existing project. The reference monorepo supplies examples, SDK source, and launcher tests; it is not the required home for real integrations.

Determine whether the provider is an extension or a page/PWA. Inspect the installed SDK version, app build, and launcher pairing configuration before changing anything. Current SDK 0.1.0 is distributed as a local/CI tarball, not an npm-published package. Do not invent an npm install command that assumes publication.

Read only the relevant guide:

- Extension: https://web-relay.github.io/guides/extensions/ — `@web-relay/sdk/extension`, service-worker registration, manifest pairing, sender identity, tab context.
- PWA: https://web-relay.github.io/guides/pwa/ — `@web-relay/sdk`, live application context, exact-origin pairing, bridge permissions, SPA cleanup.
- Packaging/API status: https://web-relay.github.io/guides/sdk/ — package imports, local tarball build/install, public API and limits.

If the docs are unavailable, inspect the packaged TypeScript declarations and the reference `packages/sdk/src/index.ts`, `packages/sdk/src/extension.ts`, and `apps/launcher-extension/src/providers.ts`. Do not treat original PRD examples as released APIs.

Register provider-owned functions with stable namespaced IDs and concise titles. Use `when` for current availability, `input: 'text'` for bounded nonblank text, and JSON or void results. Keep application state and functions in the provider; only descriptors and validated requests cross the bridge. Use `CapabilityError` for actionable failures. A timeout does not imply cancellation; avoid retries for possibly delivered writes.

Extension providers:

- Bundle `createExtensionProvider` into the existing MV3 worker and register its listener at worker startup. Register capabilities synchronously through its callback; callbacks may define asynchronous action functions.
- Pair `externally_connectable.ids` and the SDK's `launcherId` with the actual launcher ID. The exported `LAUNCHER_ID` is the local development identity, not universal production enrollment.
- Add the actual installed provider extension ID and matching provider ID to the launcher's `extensionProviders` configuration. Require explicit user scope for new origins/providers; SDK installation alone does not authorize wider access.
- The SDK checks active tab ID/URL before invoking. If actions use supplied URL context, request `tabs` and any actual action-specific permissions; keep optional/missing context supported.

PWA providers:

- Create `createLauncher({providerId, context: () => liveAppState})` once per app integration and call `dispose()` during teardown. Do not serialize functions or stale copies of selected state.
- Pair the provider ID and exact origin in the launcher's `pwaProviders` configuration. Add necessary host permissions and content-script matches to its manifest, then rebuild/reload the launcher. Preserve top-frame and same-origin checks.
- Capability availability comes from the owning registry. Any local palette should use that same registry, including when the browser extension is absent.

Verify discovery and execution with the real launcher and provider loaded in Chromium, including unavailable actions, stale context, returned errors, and provider/bridge trust. Use fixtures for account writes unless a live action is explicitly authorized. Report what was tested, what requires manual setup, and whether the SDK was merely built/packed or actually published.
