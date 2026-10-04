---
name: web-relay-integration
description: Add or update Web Relay launcher capabilities in an existing Chromium extension or PWA using the Web Relay SDK, including explicit provider pairing and integration verification.
---

# Integrate with Web Relay

Keep the user's app in its existing project. The reference monorepo supplies examples, SDK source, and launcher tests; it is not the required home for real integrations.

Determine whether the provider is an extension or a page/PWA. Inspect the installed SDK version, app build, and launcher pairing configuration before changing anything. Install the published SDK with `pnpm add @web-relay/sdk` or `npm install @web-relay/sdk`; use `@web-relay/sdk/extension` for Chromium extension providers. Do not assume that installing the package enrolls it with the launcher: pairing remains explicit.

Read only the relevant guide:

- Extension: https://web-relay.github.io/guides/extensions/ — `@web-relay/sdk/extension`, service-worker registration, manifest pairing, sender identity, tab context.
- PWA: https://web-relay.github.io/guides/pwa/ — `@web-relay/sdk`, live application context, exact-origin pairing, bridge permissions, SPA cleanup.
- Packaging/API status: https://web-relay.github.io/guides/sdk/ — package imports, local tarball build/install, public API and limits.

If the docs are unavailable, inspect the packaged TypeScript declarations and the reference `packages/sdk/src/index.ts`, `packages/sdk/src/extension.ts`, and `apps/launcher-extension/src/providers.ts`. Do not treat original PRD examples as released APIs.

Register provider-owned functions with stable namespaced IDs and concise titles. Use `when` for current availability, `input: 'text'` for bounded nonblank text, and JSON or void results. Keep application state and functions in the provider; only descriptors and validated requests cross the bridge. Use `CapabilityError` for actionable failures. A timeout does not imply cancellation; avoid retries for possibly delivered writes.

Extension providers:

- Bundle `createExtensionProvider` into the existing MV3 worker and register its listener at worker startup. The `register` callback may return `void` or `Promise<void>` with SDK 0.1.2 or later; load saved configuration inside it, not before attaching the listener. The SDK awaits registration for discovery and execution with a fresh registry per request. Keep registration free of action side effects and within the three-second response timeout. Confirm that older installed packages support async registration before using it; callbacks may define asynchronous action functions.
- Pair `externally_connectable.ids` and the SDK's `launcherId` with the actual launcher ID. The exported `LAUNCHER_ID` is the local development identity, not universal production enrollment.
- With launcher 0.0.2 or later, open Capability sources → Manage extension providers, check the actual installed provider extension ID, review its identity, and explicitly approve pairing. Keep current-tab URL sharing off unless the user approves it. Saved pairings can be disabled or removed without rebuilding. SDK 0.1.3 adds optional `name` and a sender-validated `describe` response, allowing pairing with no commands; older providers require at least one discoverable command. Bundled defaults remain in `extensionProviders`. Require explicit user scope for new origins/providers; SDK installation alone does not authorize wider access.
- The SDK checks active tab ID/URL before invoking. If actions use supplied URL context, request `tabs` and any actual action-specific permissions; keep optional/missing context supported.

PWA providers:

- Create `createLauncher({providerId, context: () => liveAppState})` once per app integration and call `dispose()` during teardown. Do not serialize functions or stale copies of selected state.
- With development launcher 0.0.3, open Options → Pair a web app. Open exactly one app tab, enter its full URL, approve browser host access, check its identity, and approve pairing. The root path pairs only the home page; other paths include subpages. Saved pairings can be disabled or removed. SDK 0.1.3 apps use nonempty discovery; SDK 0.1.4 adds name/describe and provider-addressed requests for multiple mounted registries. Preserve top-frame, exact-origin, path, and live context checks. Older launchers still need pwaProviders and matching manifest entries followed by rebuild/reload.
- Register at most 50 commands with titles of at most 120 characters and descriptions of at most 300. dispose() removes the listener without cancelling pending work; request IDs are not deduplicated and navigation timers do not acknowledge delivery.
- Capability availability comes from the owning registry. Any local palette should use that same registry, including when the browser extension is absent.

Verify discovery and execution with the real launcher and provider loaded in Chromium, including unavailable actions, stale context, returned errors, and provider/bridge trust. Use fixtures for account writes unless a live action is explicitly authorized. Report what was tested, what requires manual setup, and whether the SDK was merely built/packed or actually published.
