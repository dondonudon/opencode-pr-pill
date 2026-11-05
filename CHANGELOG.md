# Changelog

All notable changes to `opencode-pr-pill` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-11-05

### Added

- **Monitor** button on every PR row. It sends a queued prompt to the current session asking the
  agent to start `pr_monitor` for that PR and keep working until the PR is ready. The button shows
  `Requested` for five minutes, reports failures in an alert, and clears on cancel.
- Confirmation dialog that explains the side effect before anything is sent.
- `monitor.*` i18n strings.

### Changed

- The Monitor request goes to the session's own server (`session.server.client`), falling back to the
  panel client when no server ref is available.
- README now leads with npm installation and records the tested OpenCode Desktop version.

### Fixed

- Session-switch cache race: a fetch no longer caches a snapshot taken before the session's watch
  list finished loading.
- Stale in-flight responses are discarded instead of overwriting a newer snapshot.

## [0.2.2]

### Changed

- Branch and watched-PR fetches run in parallel.
- The repository is resolved from `git remote` instead of `gh repo view`, removing one network call.

## [0.2.1]

### Added

- Server-side memoization of recent `gh` reads for 20 seconds.

### Fixed

- Rapid session switching no longer re-runs every `gh` query.

## [0.2.0]

### Added

- Per-session watch list, persisted across restarts.
- Cross-repository watches by URL or `owner/repo#number`.
- `Could not load` rows with a remove action for watches that cannot be resolved.

### Changed

- The sidebar tab and titlebar chip only register when a PR is present.

## [0.1.0]

### Added

- Initial release: branch-scoped pull request panel for OpenCode Desktop with CI status, review
  decision, mergeability, unresolved review threads, and titlebar / command-palette entry points.
