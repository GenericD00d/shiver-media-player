<p align="center"><img src="logo.png" alt="Shiver Media Player logo" width="160"></p>

# Shiver Media Player

A Sharkord plugin for watching videos together in a voice channel. Paste a link,
and it plays as a stream in the channel you are in. Pause, seek and stop apply
to everyone.

## A disclaimer worth reading

**This project is vibecoded.** Almost all of it was written by an LLM working
from one person's direction, review and bug reports.

- **No independent security audit has been done.** It makes your server fetch
  the links members paste, and runs yt-dlp and ffmpeg, which it downloads. Read
  the code before you trust a server to it. Its internal reviews are listed in
  [SECURITY.md](SECURITY.md#review-history); they are not an outside audit.
- **Releases are checked only against a checksum published in the same
  release**, which catches a damaged download but not a compromised account
  ([RELEASING.md](RELEASING.md#keys)).
- It is early software. Expect rough edges, and expect things to change.

It is offered as-is.

## What it does

- Works with YouTube, Dailymotion, and the ~1800 other sites
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, pages with embedded
  players, and direct links to `.mp4`, `.webm`, `.mkv`, `.m3u8`, `.mp3` and so on.
- One video per voice channel, any number of channels at once, each with its own video.
- Live streams play too (no seeking).

Everything runs on the server, so viewers stay in sync automatically: there is
one source, and every viewer gets the same frames. A source with only audio gets
a black picture, and a source with only video gets silence, so every stream
carries both tracks. [ARCHITECTURE.md](ARCHITECTURE.md) has the details.

## Install

With the [Shiver Server Manager](https://github.com/GenericD00d/shiver-server-manager),
install it from the server's plugins. By hand:

1. `bun run setup` (once). It links the Sharkord SDK, which is not on npm yet.
2. `bun run build`. The plugin is written to `dist/shiver-media-player/`, and
   also copied into your server if `SHARKORD_PLUGINS_PATH` is set in `.env`.
3. Copy that folder into your server's plugins directory, then enable it under
   Server Settings → Plugins.

On first load the plugin downloads `ffmpeg` and `yt-dlp` into
`<data-dir>/plugin-data/shiver-media-player/bin` (Linux x64/arm64, Windows x64).
A binary already in that folder, or on the server's `PATH`, is used instead.

## Usage

Join a voice channel and click the screen icon next to the camera and
screen-share buttons:

- **Paste a link → Play**: starts it in your voice channel. If something is already playing, it gets replaced.
- **Pause / Play, -10s / +10s, seek bar**: everyone sees the change.
- **Stop**: removes the stream from the channel.

Everyone in the channel watches the stream card the same way they watch a
screen share. Each viewer can still set their own volume on the card.

Playback stops by itself when the video ends or the last person leaves the channel.

## Settings

- **Max video height** (default 720): the largest height a video is streamed at, 144 to 1080.
- **Video bitrate** (default `2500k`): limited by your server's upload. Each
  active channel costs one stream's worth of upload per viewer, plus one
  real-time x264 encode of CPU.
- **Proxy** (optional, empty by default): fetches every video through a proxy,
  for when a site blocks the server's IP. Takes `http://host:port`,
  `socks5://host:port` or `socks5h://host:port`, optionally with `user:pass@`.
  Every request first goes through the plugin's own guard on `127.0.0.1`, which
  looks up each name itself and hands the proxy only the address it checked, so
  `socks5h://` no longer has the proxy resolve names: it behaves like
  `socks5://`. An http proxy is asked to `CONNECT` to that address, plain http
  too. An invalid value makes playback fail instead of quietly bypassing the
  proxy.
- **Simultaneous streams** (default 3): how many voice channels can play at once
  across the server. Each member can also start at most 6 videos a minute.

## Permissions

The button and every control need `JOIN_VOICE_CHANNELS`, and the owner can
narrow that per role in the plugin's permissions. `/shiver-update-yt-dlp` needs `MANAGE_PLUGINS`.

The server fetches the link it is given, and everything that link leads to.
Every one of those requests goes through the plugin's guard, which refuses
loopback, private, link-local, cloud metadata and other non-public addresses,
however the name resolves, so a link can't reach your internal network; playback
then stops with "That link leads to an address on the server's own network".
Resolved media is limited to http(s), so a link can never make ffmpeg read files
on the server. Members who can play still choose what the server downloads, so
grant playback to people you trust with its bandwidth.

## Known limitations

- Binaries are downloaded only for Linux x64 and arm64 and Windows x64; elsewhere
  they must be on the server's `PATH` or in the `bin` folder.
- Live streams can't be seeked.
- Each active channel costs one real-time encode, so a small server can carry
  only a few at once; **Simultaneous streams** sets how many.

## Troubleshooting

- **A site stopped working / "Sign in to confirm you're not a bot"**: run
  `/shiver-update-yt-dlp`. If YouTube keeps blocking the server's IP, export
  cookies to `<data-dir>/plugin-data/shiver-media-player/bin/cookies.txt`, or set the **Proxy** setting.
- Errors from yt-dlp and ffmpeg are in the plugin's **Logs** tab.

## Building

`bun run setup` once, then `bun run build`. `bun test` covers the yt-dlp
parsing, the probing, and the ffmpeg command line. `scripts/check-types.sh`
type-checks the plugin's own code, and only counts the errors the linked SDK
reports about itself. `scripts/check.sh` runs every check; [AGENTS.md](AGENTS.md)
has the rules not to break, and [RELEASING.md](RELEASING.md) the release steps.

## The Shiver family

- [Shiver](https://github.com/GenericD00d/Shiver): the desktop and Android client, and the companion plugin
- [shiver-server-manager](https://github.com/GenericD00d/shiver-server-manager): sets up and runs Sharkord servers, with the Shiver plugins
- **shiver-media-player**, this repo
- [shiver-temp-share](https://github.com/GenericD00d/shiver-temp-share): a plugin for sharing large files with links that expire

## Licence

MIT. See [LICENSE](LICENSE).
