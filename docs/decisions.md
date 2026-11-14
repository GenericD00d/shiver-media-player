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

## 2026-11-13: Pinned binaries, and yt-dlp from its stable releases

**Why:** the plugin downloaded the latest yt-dlp nightly and the latest ffmpeg build and ran them
unchecked, so whoever could change those release pages decided what the server ran. Decision D6 of
the family review had already agreed a pinned stable yt-dlp.

**Consequences:** `DOWNLOADS` pins yt-dlp 2026.10.26 and plugin-binaries 0.0.1, with a SHA-256 for
each platform, checked before a download is written. yt-dlp's hashes are from its `SHA2-256SUMS`;
ffmpeg's are trust on first use, since its releases publish none. `/shiver-update-yt-dlp` takes
the latest stable yt-dlp only when that release's `SHA2-256SUMS` has a matching line. Bumping the
pins is in RELEASING.md. Checking yt-dlp's signature on `SHA2-256SUMS` is left for later.

## Open items

- yt-dlp 2026.10.26 warns that Bun 1.4.4 (Sharkord 0.0.31's) is newer than the last Bun it supports,
  1.3.14. YouTube still played and seeked on a test server with it. If YouTube starts refusing,
  check that warning first, and whether a newer yt-dlp supports the newer Bun.
- Sharkord's client can miss a swap when two arrive close together: it logs "skipped, consume
  already in progress" and keeps the producer that was just closed, so that viewer's picture stops
  until the next seek, pause or rejoin. Seen once on a test server with seeks a few seconds apart.
  Keeping one pair of producers for the whole session would avoid swaps; that needs a transport
  that accepts a new sender, which comedia doesn't.

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

### Seeking stopped YouTube videos: yt-dlp had no JavaScript runtime (fixed)

yt-dlp was told `--js-runtimes bun`, which needs `bun` on the PATH. A Sharkord server is one
compiled Bun program, so there was none: yt-dlp warned "No supported JavaScript runtime could be
found", skipped YouTube's challenge, and its links played from the start but refused the range
requests that a seek or resume makes. The retry without the challenge failed the same way, and the
session ended. yt-dlp now gets `bun:<the running executable>`, started with `BUN_BE_BUN=1`, which
makes a compiled Bun program act as the `bun` CLI (checked with Bun 1.4.0; Sharkord 0.0.31 is built
with 1.4.4). Reported by the owner on Sharkord 0.0.31.

That fix was right but wasn't the cause: the owner still couldn't seek on 0.0.8. See the next entry.

### Seeking and resuming sat on "Loading" for minutes (fixed)

Found by running Sharkord 0.0.31 with the plugin and a headless Chrome in the voice channel, then
seeking Big Buck Bunny from YouTube. After a seek the new ffmpeg never sent a packet, so the
stream stayed on "Loading". Run by hand, the same ffmpeg took 318 seconds to open the link at
45 seconds in, and two seconds once open. Its debug log said why: it opens the file with
`Range: bytes=0-`, and reaches the seek point by "soft-seeking", reading and discarding everything
up to it (12.5 MB) on that one connection. YouTube serves an open-ended request at about playback
speed (40 KB/s here), while bounded ranges came at 7 to 16 MB/s. Playing from the start never
noticed, since playback speed is enough. `-request_size` (10 MB, like yt-dlp's chunks) makes every
request bounded, so a seek is a new range request: seeks to 0:45 and 5:00 opened in about a second.

### The picture froze for seconds after a seek (fixed)

The same test showed viewers decoding one GOP after each seek, then losing packets on localhost,
with the decoder waiting for a keyframe that also lost packets. A plain transport has no
retransmission, so each lost packet freezes the picture until a keyframe arrives whole. The bursts
were keyframes: `-bufsize` equal to the bitrate let x264 make a keyframe up to a second's worth
(about 300 KB at 2500k), sent as one burst of UDP packets, which overflowed the receiving socket.
At a fifth of a second (500 kbit at 2500k), three seeks lost nothing and played at
25 fps. Windows' small default socket buffer made it frequent there; Linux's default (208 KB) is
still smaller than a full second's keyframe.

### ffmpeg's packets were refused on Windows (fixed)

ffmpeg sent RTP to the address the transports listen on, `0.0.0.0`. Linux takes that as this
machine; Windows refuses it (error 10049). The wildcard is now sent to loopback.
