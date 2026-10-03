# Web Relay

A local-first browser capability runtime, starting with a PWA and two independently loaded browser extensions in one pnpm monorepo.

**Status:** development scaffold. The PWA has an offline shell, and both extensions can be loaded unpacked. Discovery, command execution, provider approval, and composition are not implemented yet.

Documentation and decisions: https://web-relay.github.io/ — maintained in https://github.com/web-relay/web-relay.github.io.

## Workspace

| Directory | Responsibility |
| --- | --- |
| `apps/demo-pwa` | Local application, eventual in-app palette and app-owned actions. |
| `apps/launcher-extension` | Global discovery, command UI, and invocation routing. |
| `apps/webapp-extension` | Separate provider extension for a selected web app. |
| `packages/core` | Initial shared capability metadata types; future local registry. |
| `packages/protocol` | Shared development metadata; future validated message contracts. |

The two extensions are separate browser installations even though they share source packages. Local ownership simplifies explicit provider configuration, but does not remove origin checks, extension IDs, permissions, or execution boundaries. “Composition” initially means aggregating commands across providers, not a workflow engine.

## Develop

Use Node.js >=22.12 and pnpm 12.8.1 (CI uses Node.js 24).

```sh
pnpm install
pnpm check
pnpm build
pnpm dev:pwa
```

Open http://localhost:4173. The development server binds to loopback. Rebuild after source changes; automatic reload is not implemented. The PWA is an offline-capable shell; browser installability has not been validated yet.

For each extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select its `apps/<name>/dist` directory. Reload the extension after rebuilding. There are no host permissions or content scripts yet; those will be added with explicit provider and bridge decisions.

## Next working slice

1. Define and test a local capability registry and context lifecycle.
2. Run one PWA action from an in-app palette.
3. Define validated discovery and invocation contracts.
4. Connect the launcher to the PWA with explicit trust approval.
5. Add browser actions and a command from the second extension.

Use Chromium for the initial development and extension testing. Headless UI checks alone do not prove extension messaging; future tests must exercise full Chromium with both extensions loaded.

Record accepted decisions and discoveries in the documentation site with the relevant implementation change. Keep unimplemented APIs clearly marked as proposals.

## License

MIT; see LICENSE.
