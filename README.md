# Web Relay

A local-first browser capability runtime, demonstrated with a notes PWA, launcher extension, and independent GitHub.com provider extension in a pnpm monorepo.

**Status:** working development showcase. SDK 0.1.4 is published as `@web-relay/sdk` with bundled JavaScript and TypeScript declarations. Real PWA and cross-extension discovery and invocation are implemented. No backend or GitHub API token is needed.

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

Reload both extensions after rebuilding. Pin the launcher in the toolbar. Its button injects a command dialog into the active website; use the button or `Alt+Shift+Space` (check `chrome://extensions/shortcuts` if the shortcut conflicts).

1. On the PWA, use either palette to **Create note**. Select an unpinned note to discover **Pin selected note**; pin it and the command disappears.
2. On `https://github.com/web-relay/web-relay`, open the launcher for **Open current repository**, **Open repository issues**, and **Open repository pull requests**.
3. The GitHub provider also exposes **Open Web Relay repository** from any tab. Disable it under **Capability sources** to remove its commands and prevent execution.
4. Browser commands include **Copy current URL**, **Open new tab**, **Open downloads**, and **Duplicate current tab**. Copy and duplicate require an HTTP(S) tab.
5. Search tabs by title or URL, or type `tabs` to narrow to the current window's tab commands. Use ↑/↓ and Enter to switch. Tabs in other windows are excluded.

The launcher follows the system light/dark theme. Search matches every word across command title, description, and provider ID: `llm gemini` narrows to the Gemini provider command, while `tabs github` finds matching tabs. Provider scopes entered with Tab remain a design proposal.

AI commands belong to the separate LLM provider; the launcher contains no built-in ChatGPT or Gemini commands. ChatGPT uses a copied page-context prompt that you paste and send. Gemini retains automatic sending.

Actions are discovered when opening or refreshing the launcher; invocation rechecks provider availability and active-tab context. This is pull discovery, not a continuously pushed registry. Errors and timeouts are shown in the launcher. A timeout does not cancel an already-running action; check the app before retrying.

## Separate LLM provider

The sibling `../llm-provider-extension` folder is a real integration outside this example/test workspace. It uses `@web-relay/sdk/extension` to register ChatGPT and Gemini commands with the current page URL as context. Build it separately and load its `dist` folder; this launcher explicitly pairs its development extension ID. No example PWA or GitHub provider is required for it. See that folder's README for setup and delivery behavior.

The monorepo supplies the reference runtime, examples, shared SDK source, and integration test harness. Real providers and PWAs can live independently; the source folder location is not a discovery mechanism. Additional extensions can be explicitly paired in launcher settings.

## Workspace

| Directory | Responsibility |
| --- | --- |
| `apps/demo-pwa` | Notes app, local palette, persisted notes, offline shell. |
| `apps/launcher-extension` | Search, keyboard UI, discovery, routing, browser actions. |
| `apps/webapp-extension` | GitHub navigation provider, built separately from the launcher. |
| `packages/core` | Provider-owned registry, metadata, availability, execution, unregister. |
| `packages/protocol` | Versioned wire messages, validators, correlation, timeout helpers, development identities. |
| `packages/sdk` | PWA integration connecting its registry to the content-script bridge. |

The PWA owns live app state and functions. The launcher receives JSON metadata and sends correlated invocation requests. Functions are never transferred. The contract supports no-input actions and optional `input: "text"` actions with a question of up to 2000 characters. Input schemas, WebMCP, and workflows remain deferred. Development launcher 0.0.3 supports explicit PWA pairing in Options with optional host access and path scopes. Actions may return nothing; the registry normalizes that to null. A missing transport reply after send is an unconfirmed handoff, not proof of success.

## Delivery and dismissal

The injected launcher closes on Escape, clicking its backdrop, loss of window focus, tab switching, or navigation. Closing the launcher does not cancel an action already sent. A returned error is shown if the UI is still present. Optional results are accepted, and an error while refreshing commands after delivery is not displayed as an execution failure.

The Manifest V3 worker is a small event-driven broker for toolbar clicks, browser APIs, and cross-extension requests. It holds no live capability registry. Session storage holds the UI tab ID and short-lived pairing proposals; approved extension pairings are stored locally. We are targeting local unpacked extensions; store packaging and production enrollment are outside this slice.

Injection works on ordinary HTTP(S) sites. Chromium prevents injection on internal pages such as `chrome://` and some protected sites. The extension shows a badge if injection fails; open a regular website and retry.

## Trust and permissions

- The demo trusts exactly `http://localhost:4173` and `http://127.0.0.1:4173`. The content-script host patterns cover local hosts; the script validates the exact origin and top frame.
- Manifest public keys make unpacked extension IDs stable. The launcher explicitly targets the known provider ID, and the provider accepts only the paired launcher ID through `externally_connectable` and a sender check. These are development identities, not protection against someone who controls your unpacked source.
- The launcher uses `activeTab` and `scripting` to inject the UI after a toolbar action or shortcut, without automatic access to every website. It also uses `tabs` for active-tab metadata and duplication, `storage` for provider preferences, and `clipboardWrite` for copying URLs in its popup.
- The provider requests the GitHub.com host only to inspect repository context. It uses tab navigation, no DOM selectors, downloaded code, account API, or GitHub writes.
- The injected UI runs in Chrome’s isolated content-script world and may call the privileged internal API only from a top-frame sender belonging to this extension. Invocation context is bound to its source tab and URL. The extension’s own diagnostic popup document is also permitted. Page scripts cannot call this API through the PWA bridge. PWA messaging checks window source, origin, protocol, and request correlation. Execution rejects stale tab snapshots and rechecks availability in the app.

The SDK assumes code within the trusted PWA origin is trusted. Broader provider enrollment, sensitive-action confirmations, and production permission onboarding remain design work.

## Validation

```sh
pnpm test                  # Registry, wire contract, origins, timeouts, GitHub URL model
pnpm exec playwright install chromium
pnpm test:e2e              # Build first; loads both real extensions in persistent Chromium
```

Set `CHROMIUM_PATH` to reuse an installed full Chromium binary. The integration tests start the PWA server if needed. The original test covers the diagnostic popup document and extension APIs. The injected-UI suite triggers the actual toolbar action through Chromium’s extension debugging API and tests the dialog directly on the host page, including `activeTab` injection on GitHub. Service workers, content-script messaging, cross-extension requests, clipboard, and navigation are real.

GitHub navigation uses intercepted URL fixtures, so tests do not interact with a GitHub account. Tests also cover stale commands, stale tabs, disabled providers, unsupported protocol versions, note persistence, and the offline PWA. The AI destination pages are also fixtures; tests never submit prompts to an account. Screenshots are saved in `test-results/`.

## Documentation

The site remains in https://github.com/web-relay/web-relay.github.io. Update the current design pages and decision log as contracts or behavior change, and distinguish implemented functionality from proposals. The original PRD remains preserved.

## License

MIT; see LICENSE.

## Build another integration

Install the published SDK with `pnpm add @web-relay/sdk` or `npm install @web-relay/sdk`. To test a local build, `pnpm pack:sdk` produces an installable tarball under `artifacts/`. Do not use workspace aliases in package consumers. See [SDK installation](https://web-relay.github.io/guides/sdk/), [extension providers](https://web-relay.github.io/guides/extensions/), and [PWAs](https://web-relay.github.io/guides/pwa/).

With launcher 0.0.2, open Capability sources → Manage extension providers, paste an extension ID, check the connection, and approve pairing. Choose whether to share the current tab URL (off by default). Disable/remove saved pairings in the same settings page; no rebuild is needed. SDK 0.1.3 providers can supply a readable `name` and pair before they expose any commands; older providers need one discoverable command. The provider must allow the actual launcher ID. Bundled defaults and exact PWA origins remain in `apps/launcher-extension/src/providers.ts`. With development launcher 0.0.3, use Options → Pair a web app to approve host access, check its identity and approve an origin/path pairing without rebuilding. The root path pairs only the home page; child paths include subpages. SDK installation alone does not enroll a provider.

Coding agents can use `packages/sdk/skills/web-relay-integration/SKILL.md`, also included in the SDK package. Run `pnpm test:sdk` for an isolated package-consumer check.
