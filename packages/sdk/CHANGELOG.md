# Changelog

## 0.1.4 — 4 October 2026

- PWA providers accept an optional display name and return identity to `describe` requests.
- PWA registries ignore requests addressed to another provider ID, supporting shared-origin routing and multiple mounted registries.
- Validate provider identity and capability metadata during registration. Reject descriptions longer than 300 characters and a 51st PWA/extension command before discovery.
- Document disposal of pending actions, duplicate request behavior and navigation delivery limits.
- Add committed Chromium PWA pairing and deployed Personal Hub checks. Pairing settings require launcher 0.0.3; installing the SDK alone never enrolls a provider.

Protocol version 1 and existing unaddressed PWA requests remain supported. SDK 0.1.3 PWAs can pair through validated nonempty discovery. Invalid registrations that were previously accepted now fail with actionable errors.
