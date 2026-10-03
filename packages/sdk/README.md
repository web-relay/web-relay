# Web Relay SDK

Local capability registration for PWAs and independently installed Chromium provider extensions. Version 0.1.0 provides bundled ESM JavaScript and TypeScript declarations with no runtime npm dependencies. **Not published to npm yet.**

## Install the development package

From the reference repository:

```sh
pnpm install --frozen-lockfile
pnpm pack:sdk
```

Then, from your app or extension project:

```sh
pnpm add /absolute/path/to/web-relay/artifacts/web-relay-sdk-0.1.0.tgz
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

## Pairing is explicit

Installing the SDK does not enroll a provider automatically. Configure `apps/launcher-extension/src/providers.ts` in the launcher source, rebuild, and reload it. Extension IDs and PWA origins must match exactly. PWAs at new hosts also require explicit launcher manifest host permissions/content-script matches. Existing app permissions are not silently broadened.

- [Extension integration guide](https://web-relay.github.io/guides/extensions/)
- [PWA integration guide](https://web-relay.github.io/guides/pwa/)
- [Distribution and API status](https://web-relay.github.io/guides/sdk/)

## Coding agents

The package includes [a portable integration skill](skills/web-relay-integration/SKILL.md). Copy its directory from `node_modules/@web-relay/sdk/skills/web-relay-integration` to your project's `.agents/skills/web-relay-integration` or your agent's supported skill directory. Existing projects can also link an `AGENTS.md` to the two integration guides. The skill covers both PWA and extension flows and preserves the launcher/provider trust boundary.

## Distribution checks

In the reference repository, `pnpm test:sdk` packs the SDK, installs it offline into an isolated project, checks its public TypeScript imports, and executes both PWA and extension transports. The normal runtime build also builds this SDK. CI produces a tarball artifact; this is not an npm release. npm publication requires an authorized account for the `@web-relay` scope and an explicit release step.
