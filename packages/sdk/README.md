# Web Relay SDK

Local capability registration for PWAs and independently installed Chromium provider extensions. Version 0.1.4 provides bundled ESM JavaScript and TypeScript declarations with no runtime npm dependencies.

## Install from npm

```sh
pnpm add @web-relay/sdk
# or: npm install @web-relay/sdk
```

Import the PWA API from `@web-relay/sdk` and the extension provider API from `@web-relay/sdk/extension`. See the [extension integration guide](https://web-relay.github.io/guides/extensions/) and [PWA integration guide](https://web-relay.github.io/guides/pwa/) for pairing and setup. Installing the SDK does not automatically enroll a provider; the launcher must explicitly pair provider IDs and PWA origins.

To pin a release, use `pnpm add @web-relay/sdk@0.1.4` (or `npm install @web-relay/sdk@0.1.4`).

## Install the development package

From the reference repository:

```sh
pnpm install --frozen-lockfile
pnpm pack:sdk
```

Then, from your app or extension project:

```sh
pnpm add /absolute/path/to/web-relay/artifacts/web-relay-sdk-0.1.4.tgz
```

Use your normal browser bundler. Do not copy the reference project's TypeScript path aliases into a package consumer. Node.js is needed for tooling, not for an installed extension or running PWA.

## APIs

| Import | Purpose |
| --- | --- |
| `createLauncher` from `@web-relay/sdk` | Create a provider-owned PWA registry and same-origin page bridge. |
| `Registry`, `CapabilityError`, capability/JSON types from `@web-relay/sdk` | Local execution and typed application integration. |
| `createExtensionProvider`, `LAUNCHER_ID` from `@web-relay/sdk/extension` | Serve discovery and execution from a separately installed extension. |
| `TabContext`, `JsonValue`, `CapabilityError` from `@web-relay/sdk/extension` | Context and result types for extension actions. |

Register capabilities with `id`, `title`, optional `description`, optional `input: 'text'`, optional `when(context)`, and `run(context, input)`. Functions remain in the provider. Actions can return JSON or nothing. Text input is nonblank and limited to 2000 characters. Availability is checked again before execution. A timeout does not cancel an already-delivered action.

## Extension registration from storage

Call `createExtensionProvider` synchronously at service-worker startup. Its `register` callback can return `void` or `Promise<void>`; the SDK awaits it on both discovery and execution. This lets saved configuration define commands without delaying listener installation:

```ts
createExtensionProvider({
  providerId: 'workspaces',
  name: 'Saved workspaces',
  launcherId: 'your-paired-launcher-extension-id',
  async register(registry) {
    const workspaces = await loadSavedWorkspaces();
    for (const workspace of workspaces.filter(item => item.enabled)) {
      registry.register({
        id: `workspaces.open-${workspace.id}`,
        title: `Open ${workspace.name}`,
        run: () => openWorkspace(workspace.id),
      });
    }
  },
});
```

Import `createExtensionProvider` from `@web-relay/sdk/extension`. `loadSavedWorkspaces` and `openWorkspace` are provider-owned functions. Validate saved IDs/titles against the capability rules and expose at most 50 commands. Each request gets a fresh registry; deleted/disabled commands return `NOT_FOUND` on execution. Registration failures use the normal error response. Requests can overlap, so keep request-specific data local. Registration should only load/describe commands, with no action side effects, and finish within the launcher's three-second timeout. Supplied active-tab context is rechecked after registration.

Async registration requires SDK 0.1.2 or later. Build and install the development tarball when testing source changes. See the [saved-configuration guide](https://web-relay.github.io/guides/extensions/#commands-from-saved-configuration). Older installed SDKs may not await the callback.

## Pairing is explicit

Installing the SDK does not enroll a provider automatically. With launcher 0.0.2 or later, open **Capability sources → Manage extension providers** (or the extension's Options page), paste the installed provider extension ID, check the connection, and explicitly approve pairing. Approved extension pairings persist in this browser profile without rebuilding the launcher. Current-tab URL sharing is off by default and must be approved separately. Settings can disable or remove saved pairings. The provider must still match the launcher's actual ID in `launcherId` and `externally_connectable.ids`.

SDK 0.1.3 adds optional `name` to `createExtensionProvider` and a `describe` response containing `{providerId, name, protocolVersion: 1}`. The SDK answers after validating the launcher sender, without running registration or actions, so providers can pair even with no commands. Older providers can pair through validated discovery if at least one command is available. Provider names are self-reported; verify the extension ID before approving. Built-in identities and duplicate extension/provider IDs cannot be enrolled again.

The development launcher **0.0.3** adds PWA pairing in the same Options page: open the app in exactly one tab, enter its full URL under **Pair a web app**, approve browser host access, check its identity, then approve pairing. No source edits or rebuild are needed for additional hosts. The root path pairs only the home page; other paths include their subpages, so sibling apps on one origin can be paired separately. Disable/remove stops routing; browser host access is retained until revoked in extension site settings. Bundled defaults remain in `apps/launcher-extension/src/providers.ts`.

Launcher 0.0.5 shows enabled paired app actions from any tab. It caches discovered metadata and reopens closed apps at the approved path in a background tab only on invocation. Existing pairings hydrate their catalog when the app is next open. Functions and live availability stay in the owning registry; duplicate app tabs require opening the launcher in the intended app or closing duplicates. See the [PWA guide](https://web-relay.github.io/guides/pwa/#pair-in-launcher-settings).

SDK 0.1.4 accepts optional `name` and responds to `describe`. It ignores requests addressed to another `providerId`, allowing multiple mounted providers on a page. SDK 0.1.3 apps can pair via validated nonempty discovery; for multiple mounted providers, install SDK 0.1.4 or later. Registration now rejects descriptions longer than 300 characters, invalid metadata, and a 51st command for PWA/extension registries before discovery. See the [0.1.4 release notes](CHANGELOG.md).

`dispose()` removes the listener but does not cancel actions already running; their replies may still be posted. Invocation IDs are not deduplicated. Timeouts and missing replies do not authorize retrying writes. Navigation after a timer is not an acknowledged delivery contract; return-before-navigation acknowledgement remains future work.

`pnpm test:e2e` includes the committed shared-origin Chromium pairing test. `pnpm test:hub` checks the deployed Personal Hub through an actual launcher, including theme, dialog availability, and navigation to an intercepted child URL without account writes. Both use a disposable launcher copy with only the fixture host pregranted because headless CI cannot approve the native browser prompt. Production settings request optional access interactively.

- [Extension integration guide](https://web-relay.github.io/guides/extensions/)
- [PWA integration guide](https://web-relay.github.io/guides/pwa/)
- [Distribution and API status](https://web-relay.github.io/guides/sdk/)

## Coding agents

The package includes [a portable integration skill](skills/web-relay-integration/SKILL.md). Copy its directory from `node_modules/@web-relay/sdk/skills/web-relay-integration` to your project's `.agents/skills/web-relay-integration` or your agent's supported skill directory. Existing projects can also link an `AGENTS.md` to the two integration guides. The skill covers both PWA and extension flows and preserves the launcher/provider trust boundary.

## Distribution checks

In the reference repository, `pnpm test:sdk` packs the SDK, installs it offline into an isolated project, checks its public TypeScript imports, and executes both PWA and extension transports. The normal runtime build also builds this SDK. Releases are published from GitHub Actions using npm trusted publishing; the workflow runs the full checks before publishing.
