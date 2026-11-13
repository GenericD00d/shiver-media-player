# Shiver Media Player: agent guide

## What this repo is

A [Sharkord](https://github.com/sharkord/sharkord) plugin for watching videos together in a voice
channel. A member pastes a link; the server resolves it with yt-dlp, transcodes it in real time with
ffmpeg, and publishes it into the channel as a stream, so every viewer sees the same frames.

It has two halves built from one codebase. The server half (`src/server/`) runs inside the Sharkord
server process, as that server's own user. The client half (`src/client/`) is React that Sharkord
renders in the voice controls.

The server fetches whatever link it is given and runs programs it downloads, so read SECURITY.md
before changing anything in [Rules that must not break](#rules-that-must-not-break).

## The Shiver family

The four Shiver repos, and the contracts between them, are in
[docs/standards.md](docs/standards.md#the-shiver-family). This repo's side of them:

- It publishes `shiver-media-player-<version>.tar.gz` with `<version>.json`, which the server
  manager installs through its `plugins.json`.
- Its plugin id, `shiver-media-player`, never changes: Sharkord keys the plugin's stored data by it.
- `scripts/setup.ts` builds against the Sharkord release the family is tested against.

## Commands

```bash
bun run setup               # once: clones the Sharkord SDK and builder into .repos/ and links them
scripts/check.sh --quick    # docs, versions and unit tests: seconds
scripts/check.sh            # + install from the lockfile, dependency audit, type check
```

The pieces:

```bash
bun test                        # unit tests: yt-dlp parsing, probing, the ffmpeg command, the proxy
bun run check-types             # type check; ignore errors from inside the linked SDK packages
bun run build                   # writes dist/shiver-media-player/
python3 scripts/check-docs.py   # the docs follow docs/standards.md
python3 scripts/check-version.py
```

Releases are in [RELEASING.md](RELEASING.md).

## Layout

```
src/server/index.ts   the plugin's entry: settings, actions, the command, one session per channel
src/server/media.ts   the binaries, yt-dlp resolving, ffmpeg's command line
src/server/proxy.ts   the proxy setting, and the HTTP bridge ffmpeg uses for SOCKS proxies
src/server/limits.ts  the caps on streams and plays; text.ts cleans titles; addresses.ts public-only checks
src/client/           the button and controls (player.tsx), and the slots they go in (index.ts)
src/contract.ts       the types both halves share
scripts/              setup.ts (the SDK), check.sh, check-docs.py, check-version.py
```

[ARCHITECTURE.md](ARCHITECTURE.md) has the flows and contracts.

## Rules that must not break

SECURITY.md explains why each one matters.

| Rule | Enforced in | Tested by |
|---|---|---|
| A link must be a full http(s) URL, and reaches yt-dlp after `--`, so it can never be read as an option | `play` in `src/server/index.ts`, `resolveMedia` in `src/server/media.ts` | Review |
| ffmpeg may read only http and https, so a page can never point it at a file on the server | `sourceArgs` in `src/server/media.ts` (`-protocol_whitelist`) | `src/server/media.test.ts` |
| Media URLs yt-dlp resolves are used only if they are http(s) | `toInput` in `src/server/media.ts` | `src/server/media.test.ts` |
| The proxy setting is a plain `http://` or `socks5://` address, or playback fails rather than quietly bypassing it | `PROXY_URL` in `src/server/proxy.ts` | `src/server/proxy.test.ts` |
| Every action states the permission it needs | `src/server/index.ts` | Review |
| No more than the set number of channels stream at once, and a member can start only so many videos a minute | `play` in `src/server/index.ts`, `src/server/limits.ts` | `src/server/limits.test.ts` |
| Titles shown to viewers lose invisible and direction-changing marks | `parseYtDlpInfo`, `src/server/text.ts` | `src/server/text.test.ts` |
| Addresses on the server's own network are refused by `isPrivateAddress`, which keeps the companion plugin's test vectors | `src/server/addresses.ts` | `src/server/addresses.test.ts` |

## Conventions

- **Bun and TypeScript**, no framework. The SDK comes from Sharkord's repo through `bun run setup`,
  not from npm.
- **The two halves share types only**: `src/contract.ts`, imported with `import type`.
- **Programs run as argument lists** through `Bun.spawn`, never through a shell.
- **Comments say why.** Docs use British spelling.
- **Commits** have a plain-English subject saying what changed and a body saying why.

## When you change something

- **An action, its payload or the pushed state**: `src/contract.ts`, and both halves.
- **A setting**: README's Settings section.
- **Something users will notice**: a line under `## Unreleased` in CHANGELOG.md.
- **A release**: bump `manifest.json` and `package.json` together; RELEASING.md has the rest.
- **A decision or a bug worth remembering**: `docs/decisions.md`.
- **docs/standards.md** changes only as its last section describes.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md): how a link becomes a stream, and the contracts
- [SECURITY.md](SECURITY.md): trust boundaries, scope and review history
- [RELEASING.md](RELEASING.md): building, publishing and verifying a release
- [docs/decisions.md](docs/decisions.md): decisions, open items and the bug log
- [docs/standards.md](docs/standards.md): the standard all four Shiver repos follow
