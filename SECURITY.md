# Security

## Reporting a problem

**Please do not open a public issue for a security problem.** Use GitHub's private reporting
instead: **Security → Advisories → Report a vulnerability** on
[this repository](https://github.com/GenericD00d/shiver-media-player/security/advisories/new).
That opens a thread only you and the maintainer can see.

If that is not available to you for any reason, open an ordinary issue saying only that you have
something to report and asking for a way to send it, with no details in the issue itself.

Expect a first reply within a week. This is one person's side project.

## What this project handles

The server half runs inside the Sharkord server process, as that server's own user. It:

- fetches the links members paste, and whatever media those links lead to;
- runs yt-dlp and ffmpeg, which it downloads on first load unless the admin provides them;
- holds an optional proxy address, which may carry a username and password, in its settings;
- reads an optional `cookies.txt`, which the admin puts in its `bin` folder.

**No independent security audit has been done.** Its internal reviews are listed under
[Review history](#review-history).

## Trust boundaries

What the plugin does not trust, where it comes in, and what stands in its way. The rules that
enforce each line, and their tests, are in [AGENTS.md](AGENTS.md#rules-that-must-not-break).

| Untrusted | Where it comes in | What guards it |
|---|---|---|
| Links members paste | The `play` action | Full http(s) URLs only, passed to yt-dlp after `--`; only members with the plugin's voice permission can play |
| The pages and media those links lead to | yt-dlp and ffmpeg | ffmpeg reads http and https only; resolved media URLs must be http(s); timeouts on resolving and probing |
| Where those requests go | The server's network | Not limited yet: see [Design decisions](#design-decisions-worth-knowing) |
| The binaries it downloads | First load, and `/shiver-update-yt-dlp` | Not verified yet: see [Design decisions](#design-decisions-worth-knowing) |
| Members controlling playback | The actions | `JOIN_VOICE_CHANNELS`, which the owner can narrow per role; the update command needs `MANAGE_PLUGINS`; a server-wide cap on simultaneous streams and a per-member rate on plays |
| Titles the linked sites report | The player, for every viewer | Invisible and direction-changing marks dropped, controls turned into spaces, capped |

## In scope

- **A link that makes the server read a local file**, or reach anything other than http(s).
- **A link that makes the server reach addresses on its own network**, once that is refused.
- **Running a binary the plugin didn't mean to**, or one that was changed on the way.
- **Command or option injection** into yt-dlp or ffmpeg.
- **A member controlling another channel's playback**, or acting without the permission.

## Out of scope

- **What the linked sites serve.** The plugin shows the channel what a member chose to play.
- **The admin's own `cookies.txt` and proxy**, which are theirs to choose.
- **Sharkord's own vulnerabilities.** Report those to Sharkord.

## Design decisions worth knowing

- **Everything runs on the server**, so every viewer gets the same frames, and members' own
  connections never reach the linked site.
- **ffmpeg is limited to http and https** (`-protocol_whitelist`), so no link or page can make it
  read a file on the server.
- **Requests aren't limited to public addresses yet.** A link, or a playlist it leads to, can make
  the server fetch an address on its own network. This branch routes every request through a check
  on the address actually connected to.
- **The binaries aren't verified yet.** They come from GitHub over HTTPS, the same builds Sharkord's
  own plugins download. This branch pins each one to a version and a SHA-256.

## Review history

| Date | Review | Fixed in | What it found |
|---|---|---|---|
| 2026-11-13 | Review of the four Shiver repos, internal and LLM-assisted | This branch | Requests could reach the server's own network; downloaded binaries weren't verified, and yt-dlp came from its nightly channel |
