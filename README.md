<img src="logo.png" alt="" width="128" align="right">

# Shiver Media Player

A Sharkord plugin for watching videos together in a voice channel. Paste a link,
and it plays as a stream in the channel you are in. Pause, seek and stop apply
to everyone.

- Works with YouTube, Dailymotion, and the ~1800 other sites
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, pages with embedded
  players, and direct links to `.mp4`, `.webm`, `.mkv`, `.m3u8`, `.mp3` and so on.
- One video per voice channel, any number of channels at once, each with its own video.
- Live streams play too (no seeking).

## Usage

Join a voice channel and click the screen icon next to the camera and
screen-share buttons:

- **Paste a link → Play**: starts it in your voice channel. If something is already playing, it gets replaced.
- **Pause / Play, -10s / +10s, seek bar**: everyone sees the change.
- **Stop**: removes the stream from the channel.

Everyone in the channel watches the stream card the same way they watch a
screen share. Each viewer can still set their own volume on the card.

Playback stops by itself when the video ends or the last person leaves the channel.

## How it works

Everything runs on the server, so viewers stay in sync automatically: there is
one source, and every viewer gets the same frames.

1. `yt-dlp` resolves the link to media URLs (≤ the max height setting, H.264 preferred).
2. `ffmpeg` transcodes it in real time to H.264 + Opus and sends RTP into two
   mediasoup plain transports, published with `ctx.voice.createStream`.
3. Pause kills ffmpeg and remembers the position. Resume and seek restart ffmpeg
   at that position with fresh producers, swapped into the same stream with
   `stream.update`, so the card never disappears.

A source with only audio gets a black picture, and a source with only video
gets silence, so every stream carries both tracks.

## Install

1. `bun run setup` (once). It links the Sharkord SDK, which is not on npm yet.
2. `bun run build`. The plugin is written to `dist/shiver-media-player/`, and
   also copied into your server if `SHARKORD_PLUGINS_PATH` is set in `.env`.
3. Copy that folder into your server's plugins directory, then enable it under
   Server Settings → Plugins.

On first load the plugin downloads `ffmpeg` and `yt-dlp` into
`<data-dir>/plugin-data/shiver-media-player/bin` (Linux x64/arm64, Windows x64).
A binary already in that folder, or on the server's `PATH`, is used instead.

## Settings

- **Max video height** (default 720): the largest height a video is streamed at, 144 to 1080.
- **Video bitrate** (default `2500k`): limited by your server's upload. Each
  active channel costs one stream's worth of upload per viewer, plus one
  real-time x264 encode of CPU.
- **Proxy** (optional, empty by default): fetches every video through a proxy,
  for when a site blocks the server's IP. Takes `http://host:port`,
  `socks5://host:port` or `socks5h://host:port`, optionally with `user:pass@`.
  ffmpeg can't use SOCKS itself, so for SOCKS the plugin runs a small HTTP proxy
  on `127.0.0.1` that forwards through it. An invalid value makes playback fail
  instead of quietly bypassing the proxy.

## Permissions

The button and every control need `JOIN_VOICE_CHANNELS`, and the owner can
narrow that per role in the plugin's permissions. `/shiver-update-yt-dlp` needs `MANAGE_PLUGINS`.

The server fetches whatever link it is given, so only grant control to people
you trust not to point it at your internal network. Resolved media is limited to
http(s), so a link can never make ffmpeg read files on the server.

## Troubleshooting

- **A site stopped working / "Sign in to confirm you're not a bot"**: run
  `/shiver-update-yt-dlp`. If YouTube keeps blocking the server's IP, export
  cookies to `<data-dir>/plugin-data/shiver-media-player/bin/cookies.txt`, or set the **Proxy** setting.
- Errors from yt-dlp and ffmpeg are in the plugin's **Logs** tab.

## Development

`bun test` covers the yt-dlp parsing, the probing, and the ffmpeg command line.
`bun run check-types` type-checks the code (ignore errors reported from inside
the linked SDK packages).
