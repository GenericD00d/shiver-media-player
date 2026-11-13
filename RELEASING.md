# Releasing

Releases are built and published from one machine with Sharkord's plugin builder, which uploads the
plugin's archive and its checksum to a GitHub release. The server manager installs from there.

## Versions

- Bump `version` in `manifest.json` and `package.json` together: Sharkord reports the manifest's,
  and the builder names the release after it.
- Turn `## Unreleased` in CHANGELOG.md into `## <version> (<YYYY-MM-DD>)`.
- `python3 scripts/check-version.py` fails when the two versions disagree, or the changelog has no
  entry for the version. CI runs it.

## Keys

**There is no signing key yet.** A release's archive is checked against the checksum in its
`<version>.json`, published in the same release. That proves the download is intact, not who made
it. Signing releases with a key that never leaves the owner's machine is planned across the Shiver
repos (see the manager's RELEASING.md).

Publishing needs a GitHub token that can create releases on this repo, in `GITHUB_TOKEN` in `.env`.

## Building

```bash
bun run setup     # once: clones and links the Sharkord SDK and builder
bun test
bun run build     # writes dist/shiver-media-player/
```

### Bumping the binary pins

The yt-dlp and ffmpeg downloads are pinned in `DOWNLOADS` in `src/server/media.ts`: a release URL
and a SHA-256 for each of `linux_x64`, `linux_arm64` and `win32_x64`.

1. **yt-dlp**: pick a stable release of `yt-dlp/yt-dlp`, and take the three hashes (`yt-dlp_linux`,
   `yt-dlp_linux_aarch64`, `yt-dlp.exe`) from its `SHA2-256SUMS`. Download one and check it
   matches. Optionally, check `SHA2-256SUMS.sig` with yt-dlp's public key first.
2. **ffmpeg**: `diogomartino/plugin-binaries` publishes no checksums, so download the three
   archives and take their SHA-256 (`sha256sum`), on a machine you trust. Compare them with the
   digests GitHub shows for the release's assets.
3. Change the tag in `YT_DLP` or `FFMPEG` and the hashes together, then run `bun test`
   (`binaries.test.ts` checks each pin is a fixed release with a hash) and play a video.
4. Note the new versions in CHANGELOG.md.

## Signing and publishing

```bash
bun run publish   # builds, then creates the release: shiver-media-player-<version>.tar.gz and <version>.json
```

Nothing is signed yet (see [Keys](#keys)). The archive's name, and the checksum file beside it, are
a contract with the server manager's `plugins.json`
([docs/standards.md](docs/standards.md#contracts-between-the-repos)).

## Verifying a release

Download both files from the release, then:

```bash
sha256sum shiver-media-player-<version>.tar.gz   # matches "checksum" in <version>.json
tar -tzf shiver-media-player-<version>.tar.gz    # plain files only: manifest.json, server/, client/
```

Then install it on a test server, with the manager or by hand, and play a link.

## If a key is lost or leaked

- **The GitHub token**: revoke it on GitHub and make a new one. Anyone holding it could publish a
  release the manager would offer; delete any release you didn't make, and say so publicly.
- **Once there is a signing key**, it needs two backups kept apart, as Shiver's RELEASING.md
  describes.
