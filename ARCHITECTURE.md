# Architecture

The map of the media player for agents and contributors. Update it in the same commit as any change
that adds, removes, renames or moves something it lists.

## Overview

Everything happens on the server, so viewers stay in sync without trying: there is one source, and
every viewer gets the same frames.

```
 member ── Play <link> ──► play action (src/server/index.ts)
                              │
                              ▼
                   yt-dlp resolves the link to media URLs
                              │
                              ▼
            ffmpeg reads them, transcodes to H.264 + Opus, sends RTP
                              │
                              ▼
     two mediasoup plain transports ──► ctx.voice.createStream ──► every viewer in the channel
```

One session per voice channel, any number of channels at once. Pause kills ffmpeg and remembers the
position; resume and seek start it again at that position with fresh producers, swapped into the
same stream with `stream.update`, so the stream card never disappears.

What each step trusts, and what guards it, is in [SECURITY.md](SECURITY.md#trust-boundaries).

## Layout

```
src/server/index.ts       entry: settings, actions, the update command, sessions
src/server/media.ts       binaries, yt-dlp, probing, ffmpeg's command line
src/server/proxy.ts       the guard every request goes through, and the proxy setting
src/server/limits.ts      the cap on simultaneous streams, and the per-member play rate
src/server/text.ts        titles cleaned of invisible and direction-changing marks
src/server/addresses.ts   isPrivateAddress, ported from Shiver's companion plugin
src/server/*.test.ts      unit tests (bun test)
src/client/index.ts       the slots: VOICE_CONTROLS and TOPBAR_RIGHT
src/client/player.tsx     the button and the panel with the controls
src/contract.ts           TSharkord and TPlayerState, shared by both halves
build.ts                  builds the plugin with Sharkord's builder into dist/shiver-media-player/
publish.ts                publishes a release with Sharkord's builder
scripts/setup.ts          clones and links the SDK and the builder into .repos/
scripts/check.sh          every local check; check-docs.py, check-version.py and check-types.sh beside it
manifest.json             the plugin's id, version and SDK version
```

## Modules

- **`src/server/index.ts`**: `onLoad` registers three settings (`maxHeight`, `videoBitrate`,
  `proxy`), the actions in `src/contract.ts`, and the `/shiver-update-yt-dlp` command. It keeps
  one `TSession` per voice channel in `sessions`: its link, its resolved media, its status and
  position, the running ffmpeg, its transports and its stream. `restart` and the `chain` on each
  session run every start, pause and seek in order. A session ends when its video ends, when it is
  stopped, or when the last person leaves the channel.
- **`src/server/media.ts`**:
  - binaries: `getBinary` uses one in the plugin's `bin` folder, else downloads the pinned one
    (`download`, `DOWNLOADS`), refusing it unless its SHA-256 matches; `updateYtDlp` fetches the
    latest stable yt-dlp, pinned to its release's `SHA2-256SUMS` (`latestYtDlpPin`);
  - yt-dlp: `resolveMedia` runs it with `--dump-single-json`, and `parseYtDlpInfo` turns its output
    into a `TMedia` (`toInput` keeps http(s) URLs only); `probe` and `parseProbe` ask ffmpeg about a
    direct link;
  - ffmpeg: `sourceArgs`, `inputArgs` and `buildFfmpegArgs` build its command line, reading http(s)
    only and writing RTP to the transports.
- **`src/server/proxy.ts`**: `PROXY_URL` checks the setting. `startGuard` runs the guard, an HTTP
  proxy on `127.0.0.1` with a password made on each load, which every yt-dlp and ffmpeg run uses.
  It checks each request's address (`checkedAddress`) and connects to it directly, or through the
  admin's proxy with `httpConnect` or `socksConnect`, which also covers ffmpeg not speaking SOCKS.
- **`src/server/limits.ts`**: `canStartStream` (replacing a channel's own video adds no stream) and
  `createRateLimiter`, which `play` uses for 6 videos a minute per member.
- **`src/server/text.ts`**: `cleanTitle`, for the titles yt-dlp reports.
- **`src/server/addresses.ts`**: `isPrivateAddress`, global unicast only.
- **`src/client/player.tsx`**: `PlayerButton` (beside the camera and screen-share buttons) and
  `TopbarPlayerButton` (beside the call buttons) open `PlayerPanel`, with its link box and controls.
  `usePlayer` follows the pushed state for the channel.

## Flows

### Playing a link

1. `play` checks the caller is in a voice channel, the link is a full http(s) URL, the server isn't
   already streaming in as many channels as **Simultaneous streams** allows, and the member hasn't
   started too many videos this minute. It then ends any session already in that channel.
2. `resolveMedia` runs yt-dlp on the link, with the link after `--`. It picks formats up to the
   max height setting, H.264 first.
3. For a direct link whose tracks or length yt-dlp doesn't know, `probe` asks ffmpeg.
4. `restart` creates two plain transports, starts ffmpeg into them, and creates the stream, or
   updates it with fresh producers.
5. Every change is pushed to the channel's viewers as `{ channelId, state }`.

### Pausing, resuming and seeking

Pause kills ffmpeg and stores the position. Resume and seek run `restart` from a position. Live
streams can't be seeked. A YouTube link that answers 403 is resolved again once, the other way, and
the way that worked is remembered.

## Contracts

- **Actions and the pushed state**: `TSharkord` in `src/contract.ts`. `getState`, `play`, `pause`,
  `resume`, `seek` and `stop` each answer with the channel's `TPlayerState`.
- **The command** `/shiver-update-yt-dlp`, which needs `MANAGE_PLUGINS`.
- **Settings**: `maxHeight` (144 to 1080), `videoBitrate` (such as `2500k`), `proxy`, `maxStreams`.
- **Files**: `<data-dir>/plugin-data/shiver-media-player/bin/` holds the binaries and an optional
  `cookies.txt`.
- **Releases**: `shiver-media-player-<version>.tar.gz` and `<version>.json`, plugin id
  `shiver-media-player`, plugin SDK 2. See
  [docs/standards.md](docs/standards.md#contracts-between-the-repos).
