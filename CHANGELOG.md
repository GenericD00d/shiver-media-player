# Changelog

Entries up to 0.0.6 were reconstructed from the commit history on 2026-11-13.

## Unreleased

### Added

- A **Simultaneous streams** setting (default 3), and a limit of 6 videos a minute per member.

### Security

- Titles from the linked sites lose invisible and direction-changing marks before viewers see them.
- `scripts/setup.ts` builds against Sharkord's v0.0.30 release and a pinned builder, not whatever
  their main branches hold.

### Changed

- `bun audit` runs weekly as well as on every push, in its own workflow (`.github/workflows/audit.yml`), so a new advisory shows up even when nothing is pushed.
- The docs follow the Shiver standard ([docs/standards.md](docs/standards.md)): AGENTS.md,
  ARCHITECTURE.md, SECURITY.md, RELEASING.md and docs/decisions.md are new. CI checks the docs, the
  versions, the tests, the dependencies and the types.
- `bun run publish` publishes a release, as in the temp-share plugin.

## 0.0.6 (2026-11-10)

### Changed

- The way of fetching YouTube links that worked is remembered, so later plays skip the failed try.

## 0.0.5 (2026-11-10)

### Fixed

- A YouTube 403 is retried once with a fresh link, and then without the JS challenge, which picks a
  client whose links work. yt-dlp's warnings go to the plugin's log.

## 0.0.4 (2026-11-10)

### Added

- An optional HTTP or SOCKS5 proxy setting, for sites that block the server's address.

### Fixed

- The ffmpeg download on Windows.

## 0.0.3 (2026-11-10)

### Added

- The watch-together button in the top bar, while viewing the call.

## 0.0.2 (2026-11-10)

### Changed

- The plugin downloads its own yt-dlp and ffmpeg, instead of using outdated system ones.

## 0.0.1 (2026-11-10)

- The first release: watch videos together in a Sharkord voice channel.
