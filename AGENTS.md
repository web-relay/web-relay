# Web Relay development

Use the pinned pnpm version and keep TypeScript strict. Keep application functions and live context inside their owning provider; transfer JSON metadata and validated invocation messages only.

When changing contracts or behavior, update the documentation and decisions in `web-relay/web-relay.github.io`. A sibling checkout may exist at `../web-relay.github.io`. Keep implementation and documentation cross-linked. Distinguish working behavior from proposals and preserve the original PRD.

Run `pnpm check`, `pnpm test`, and `pnpm build`. Changes to discovery, routing, browser actions, or bridge behavior also require `pnpm test:e2e` with full Chromium and both extensions loaded. Unit tests and screenshots alone do not validate cross-extension messaging. GitHub integration tests use URL fixtures and must not perform account writes.

Do not expand the development allowlist or enable arbitrary providers silently. Keep local origins and development extension identities explicit. Timeouts do not imply cancellation; preserve that distinction in UI and documentation.
