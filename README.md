# Web Relay

A local-first browser capability runtime, demonstrated with a notes PWA, launcher extension, and independent GitHub.com provider extension in a pnpm monorepo.

**Status:** working development showcase, not a published or security-reviewed SDK. Real PWA and cross-extension discovery and invocation are implemented. No backend or GitHub API token is needed.

[Documentation](https://web-relay.github.io/) · [Showcase guide](https://web-relay.github.io/project/showcase/) · [Decisions](https://web-relay.github.io/project/decisions/)

## Run the showcase

Use Node.js >=22.12 and pnpm 12.8.1 (CI uses Node.js 24).

```sh
pnpm install
pnpm check
pnpm test
pnpm build
pnpm dev:pwa
```

Open http://localhost:4173. The app includes a local palette and offline shell. Rebuild after source changes; the development server does not hot-reload.

In Chromium, open `chrome://extensions`, enable **Developer mode**, and load these two unpacked directories:

- `apps/launcher-extension/dist`
- `apps/webapp-extension/dist` (GitHub provider)

Reload both extensions after rebuilding. Pin the launcher in the toolbar. Use its toolbar button or `Alt+Shift+Space` (check `chrome://extensions/shortcuts` if the shortcut conflicts).

1. On the PWA, use either palette to **Create note**. Select an unpinned note to discover **Pin selected note**; pin it and the command disappears.
2. On `https://github.com/web-relay/web-relay`, open the launcher for **Open current repository**, **Open repository issues**, and **Open repository pull requests**.
3. The GitHub provider also exposes **Open Web Relay repository** from any tab. Disable it under **Capability sources** to remove its commands and prevent execution.
4. Browser commands include **Copy current URL**, **Open new tab**, **Open downloads**, and **Duplicate current tab**. Copy and duplicate require an HTTP(S) tab.

Actions are discovered when opening or refreshing the launcher; invocation rechecks provider availability and active-tab context. This is pull discovery, not a continuously pushed registry. Errors and timeouts are shown in the launcher. A timeout does not cancel an already-running action; check the app before retrying.

## Workspace

| Directory | Responsibility |
| --- | --- |
| `apps/demo-pwa` | Notes app, local palette, persisted notes, offline shell. |
| `apps/launcher-extension` | Search, keyboard UI, discovery, routing, browser actions. |
| `apps/webapp-extension` | GitHub navigation provider, built separately from the launcher. |
| `packages/core` | Provider-owned registry, metadata, availability, execution, unregister. |
| `packages/protocol` | Versioned wire messages, validators, correlation, timeout helpers, development identities. |
| `packages/sdk` | PWA integration connecting its registry to the content-script bridge. |

The PWA owns live app state and functions. The launcher receives JSON metadata and sends correlated invocation requests. Functions are never transferred. The current contract exposes actions with no input arguments; input schemas, generic provider registration, WebMCP, and workflows remain deferred.

## Trust and permissions

- The demo trusts exactly `http://localhost:4173` and `http://127.0.0.1:4173`. The content-script host patterns cover local hosts; the script validates the exact origin and top frame.
- Manifest public keys make unpacked extension IDs stable. The launcher explicitly targets the known provider ID, and the provider accepts only the paired launcher ID through `externally_connectable` and a sender check. These are development identities, not protection against someone who controls your unpacked source.
- The launcher uses `tabs` for active-tab metadata and duplication, `storage` for provider preferences, and `clipboardWrite` for copying URLs in its popup.
- The provider requests the GitHub.com host only to inspect repository context. It uses tab navigation, no DOM selectors, downloaded code, account API, or GitHub writes.
- Only the launcher's own popup document may use its privileged internal API. PWA messaging checks window source, origin, protocol, and request correlation. Execution rejects stale tab snapshots and rechecks availability in the app.

The SDK assumes code within the trusted PWA origin is trusted. Broader provider enrollment, sensitive-action confirmations, and production permission onboarding remain design work.

## Validation

```sh
pnpm test                  # Registry, wire contract, origins, timeouts, GitHub URL model
pnpm exec playwright install chromium
pnpm test:e2e              # Build first; loads both real extensions in persistent Chromium
```

Set `CHROMIUM_PATH` to reuse an installed full Chromium binary. The integration test starts the PWA server if needed. It opens the real popup document in a tab because headless Chromium does not expose the toolbar popup as a Playwright Page. Extension APIs, service workers, content-script messaging, cross-extension requests, and tab navigation are real.

GitHub navigation uses intercepted URL fixtures, so tests do not interact with a GitHub account. Tests also cover stale commands, stale tabs, disabled providers, unsupported protocol versions, note persistence, and the offline PWA. Screenshots are saved in `test-results/`.

## Documentation

The site remains in https://github.com/web-relay/web-relay.github.io. Update the current design pages and decision log as contracts or behavior change, and distinguish implemented functionality from proposals. The original PRD remains preserved.

## License

MIT; see LICENSE.
