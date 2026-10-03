# Web Relay development

Use the pinned pnpm version and keep TypeScript strict. Keep application functions and live context inside their owning provider; transfer JSON metadata and validated invocation messages only.

When changing contracts or behavior, update the documentation and decisions in `web-relay/web-relay.github.io`. A sibling checkout may exist at `../web-relay.github.io`. Keep implementation and documentation cross-linked. Distinguish working behavior from proposals and preserve the original PRD.

Run `pnpm check`, `pnpm test`, and `pnpm build`. Changes to discovery, routing, browser actions, or bridge behavior also require `pnpm test:e2e` with full Chromium and both extensions loaded. Unit tests and screenshots alone do not validate cross-extension messaging. GitHub integration tests use URL fixtures and must not perform account writes.

Do not expand the development allowlist or enable arbitrary providers silently. Keep local origins and development extension identities explicit. Timeouts do not imply cancellation; preserve that distinction in UI and documentation.

For SDK consumers, use the packaged JavaScript/declarations, not copied workspace aliases. Read `packages/sdk/README.md` and the integration skill at `packages/sdk/skills/web-relay-integration/SKILL.md`; current extension and PWA guides are linked there. Pair additional extensions explicitly through launcher settings; `apps/launcher-extension/src/providers.ts` retains bundled defaults and PWA origins. Development launcher 0.0.3 supports explicit PWA pairing with optional host approval and path scopes in settings; older launchers require matching manifest changes. Run `pnpm test:sdk` after SDK/package changes; it verifies an isolated tarball consumer. A CI tarball is not an npm publication.
