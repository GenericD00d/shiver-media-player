# Decisions

Why the media player is the way it is, oldest first.

## 2026-11-10: Everything runs on the server

**Why:** one source keeps every viewer in sync, with no clock juggling between browsers, and
members' own connections never reach the linked site.

**Consequences:** each active channel costs one real-time x264 encode of CPU, and one stream's worth
of upload per viewer. The settings cap the height and the bitrate.

## 2026-11-10: The plugin's own yt-dlp and ffmpeg, not the system's

**Why:** distribution packages are routinely years old, and an old yt-dlp or ffmpeg rejects flags
the plugin uses, or can no longer fetch from YouTube.

**Consequences:** the plugin downloads both into its `bin` folder, the same builds Sharkord's own
plugins use. A binary the admin puts there is used instead. `/shiver-update-yt-dlp` fetches yt-dlp
again when a site changes.

## 2026-11-10: A small HTTP bridge for SOCKS proxies

**Why:** ffmpeg can't use a SOCKS proxy itself, and YouTube's media URLs only work from the address
that resolved them, so ffmpeg has to go through the same proxy as yt-dlp.

**Consequences:** for a SOCKS proxy, `ffmpegProxy` runs an HTTP proxy on `127.0.0.1` that tunnels
through it. An invalid proxy setting makes playback fail, rather than quietly bypassing the proxy.

## 2026-11-13: Follow the Shiver standard

**Why:** the four Shiver repos share one maintainer, and agents do most of the writing, so they keep
the same files, checks and security baseline ([standards.md](standards.md)).

**Consequences:** the standard docs are new, CI runs the checks, and `publish.ts` matches the
temp-share plugin's.

## 2026-11-13: Caps on streams and plays

**Why:** each stream is a real-time encode, so any member able to play could otherwise start as many
as there are voice channels, one after another.

**Consequences:** **Simultaneous streams** (default 3) caps the server, and each member can start 6
videos a minute (`src/server/limits.ts`). Replacing what plays in your own channel doesn't count
against the cap.

## 2026-11-13: One guard for every request yt-dlp and ffmpeg make

**Why:** a link, and every redirect, playlist, manifest and segment it leads to, could make the
server reach its own network: loopback, private ranges, link-local and cloud metadata addresses.
yt-dlp and ffmpeg follow those themselves, so the only place to check them all is the connection.

**Consequences:** the SOCKS bridge became the guard (`startGuard` in `src/server/proxy.ts`), started
on load and used by every run, probes included, whether or not a proxy is set. It resolves each
name once, refuses it unless every address is public, and connects to the address it checked;
an admin's proxy gets that address, so `socks5h://` no longer resolves names at the proxy. It wants
a password made on each load. A refused request ends playback saying the address isn't allowed,
and playback fails if the guard couldn't start.

## Open items

- **The downloaded binaries** aren't pinned or verified yet, and yt-dlp comes from its nightly
  channel. Pinning needs each release's SHA-256 per platform, written into `DOWNLOADS` in
  `src/server/media.ts`, with yt-dlp moved to its stable channel. See SECURITY.md.

## Bug log

### The Windows ffmpeg download failed (fixed)

Fixed in 0.0.4.

### YouTube answered 403 for some links (fixed)

A link is resolved again once, then without the JS challenge, and the way that worked is
remembered (0.0.5 and 0.0.6).

### The proxy test failed wherever NO_PROXY covered localhost (fixed)

It sent its request with `fetch`, which goes around a proxy for hosts in `NO_PROXY`, so it failed
on machines whose `NO_PROXY` covers localhost. It now writes the request to the bridge by hand, the
way ffmpeg does.
