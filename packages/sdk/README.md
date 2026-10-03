# Web Relay SDK

Local capability registration for PWAs and independently installed Chromium provider extensions. Version 0.1.2 provides bundled ESM JavaScript and TypeScript declarations with no runtime npm dependencies.

## Install from npm

```sh
pnpm add @web-relay/sdk
# or: npm install @web-relay/sdk
```

Import the PWA API from `@web-relay/sdk` and the extension provider API from `@web-relay/sdk/extension`. See the [extension integration guide](https://web-relay.github.io/guides/extensions/) and [PWA integration guide](https://web-relay.github.io/guides/pwa/) for pairing and setup. Installing the SDK does not automatically enroll a provider; the launcher must explicitly pair provider IDs and PWA origins.

To pin a release, use `pnpm add @web-relay/sdk@0.1.2` (or `npm install @web-relay/sdk@0.1.2`).

## Install the development package

From the reference repository:

```sh
pnpm install --frozen-lockfile
pnpm pack:sdk
```

Then, from your app or extension project:

```sh
pnpm add /absolute/path/to/web-relay/artifacts/web-relay-sdk-0.1.2.tgz
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

Installing the SDK does not enroll a provider automatically. Configure `apps/launcher-extension/src/providers.ts` in the launcher source, rebuild, and reload it. Extension IDs and PWA origins must match exactly. PWAs at new hosts also require explicit launcher manifest host permissions/content-script matches. Existing app permissions are not silently broadened.

- [Extension integration guide](https://web-relay.github.io/guides/extensions/)
- [PWA integration guide](https://web-relay.github.io/guides/pwa/)
- [Distribution and API status](https://web-relay.github.io/guides/sdk/)

## Coding agents

The package includes [a portable integration skill](skills/web-relay-integration/SKILL.md). Copy its directory from `node_modules/@web-relay/sdk/skills/web-relay-integration` to your project's `.agents/skills/web-relay-integration` or your agent's supported skill directory. Existing projects can also link an `AGENTS.md` to the two integration guides. The skill covers both PWA and extension flows and preserves the launcher/provider trust boundary.

## Distribution checks

In the reference repository, `pnpm test:sdk` packs the SDK, installs it offline into an isolated project, checks its public TypeScript imports, and executes both PWA and extension transports. The normal runtime build also builds this SDK. Releases are published from GitHub Actions using npm trusted publishing; the workflow runs the full checks before publishing.
