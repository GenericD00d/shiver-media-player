# Changelog

Entries up to 0.0.6 were reconstructed from the commit history on 2026-11-13.

## Unreleased

### Fixed

- YouTube videos can be seeked, paused and resumed again. yt-dlp needs a JavaScript runtime for
  YouTube's challenge and was looking for `bun` on the server's PATH, which a Sharkord server
  rarely has, so it warned "No supported JavaScript runtime could be found" and got links that
  play from the start but refuse the requests a seek makes. It now runs the challenge with the
  Sharkord executable itself, as Bun.

## 0.0.7 (2026-11-13)

### Added

- A **Simultaneous streams** setting (default 3), and a limit of 6 videos a minute per member.

### Security

- Links can no longer make the server reach its own network. Every request yt-dlp and ffmpeg make,
  redirects, playlists and segments included, goes through a guard that refuses loopback, private,
  link-local and other non-public addresses, and connects only to the address it checked. A refused
  link stops with a message saying so. With a proxy set, the guard looks names up itself and hands
  the proxy the address, so `socks5h://` now behaves like `socks5://`.
- yt-dlp and ffmpeg are downloaded from fixed releases and checked against their SHA-256 before they
  run; a file that doesn't match is refused. yt-dlp now comes from its stable releases (2026.10.26)
  rather than nightly builds, and `/shiver-update-yt-dlp` takes the latest stable one only when it
  matches that release's own `SHA2-256SUMS`.
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
