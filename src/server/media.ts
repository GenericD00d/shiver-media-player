import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { cleanTitle } from "./text";

type TLogger = { log: (...m: unknown[]) => void; error: (...m: unknown[]) => void };

type TBinary = "ffmpeg" | "yt-dlp";

/** One thing ffmpeg reads: the url yt-dlp resolved, and the headers the site wants with it. */
type TInput = { url: string; headers: Record<string, string> };

type TMedia = {
  title: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  /** the same object as `audio` when the site serves both in one file */
  video: TInput | null;
  audio: TInput | null;
};

const HTTP_URL = /^https?:\/\//i;

// ---------------------------------------------------------------- binaries

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** A download pinned to one release's file, checked against its SHA-256 before it is ever run. */
type TPin = { url: string; sha256: string };

/*
 * Bumping a pin: RELEASING.md, "Bumping the binary pins". yt-dlp's hashes come from the release's
 * own SHA2-256SUMS. plugin-binaries (the ffmpeg builds Sharkord's own music-bot and iptv plugins
 * download) publishes no checksums, so its hashes are trust on first use: taken from a download
 * on the day they were pinned (SECURITY.md).
 */
const YT_DLP = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/";
const FFMPEG = "https://github.com/diogomartino/plugin-binaries/releases/download/0.0.1/";

const DOWNLOADS: Record<string, Record<TBinary, TPin>> = {
  linux_x64: {
    ffmpeg: { url: `${FFMPEG}ffmpeg-linux-x64.tar.gz`, sha256: "da7f697fc9eaf4c878d4fc7d2dde589538b6856467aa81890afaab0a28114b42" },
    "yt-dlp": { url: `${YT_DLP}yt-dlp_linux`, sha256: "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795" },
  },
  linux_arm64: {
    ffmpeg: { url: `${FFMPEG}ffmpeg-linux-arm64.tar.gz`, sha256: "4fc0b07bf69dbaf189eb6f952601a80c2eaa48556e27119a1c5d04defc79c827" },
    "yt-dlp": { url: `${YT_DLP}yt-dlp_linux_aarch64`, sha256: "e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483" },
  },
  win32_x64: {
    ffmpeg: { url: `${FFMPEG}ffmpeg-win64.tar.gz`, sha256: "9099d52959ca4d62162551767856bd81c7dd881a29fa91e6d7ac9d955a6cd4c4" },
    "yt-dlp": { url: `${YT_DLP}yt-dlp.exe`, sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d" },
  },
};

/** Where `/shiver-update-yt-dlp` looks: yt-dlp's latest stable release. */
const YT_DLP_LATEST = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

let binDir = "";
const binaries = new Map<TBinary, Promise<string>>();

const setBinDir = (dir: string) => {
  binDir = dir;
  binaries.clear();
};

const download = async (name: TBinary, logger: TLogger, pin?: TPin): Promise<string> => {
  const arch = `${process.platform}_${process.arch}`;
  const { url, sha256 } = pin ?? DOWNLOADS[arch]?.[name] ?? {};
  const target = path.join(binDir, exe(name));

  if (!url || !sha256) {
    throw new Error(`No ${name} download for ${arch}. Install it on the server's PATH or put it at ${target}.`);
  }

  const tmp = path.join(binDir, `.download-${name}`);

  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  logger.log(`Downloading ${name} from ${url}`);

  try {
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Downloading ${name} failed: HTTP ${res.status}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = createHash("sha256").update(bytes).digest("hex");

    // checked before anything is written, so a changed file is never unpacked, made executable or run
    if (got !== sha256.toLowerCase()) {
      throw new Error(`${name} from ${url} isn't the expected file (SHA-256 ${got}, expected ${sha256}). Nothing was installed.`);
    }

    // written beside the target and renamed, so a failed download never replaces a working binary
    let staged = path.join(tmp, exe(name));

    if (url.endsWith(".tar.gz")) {
      await new Bun.Archive(bytes).extract(tmp);

      const archiveName = path.basename(url).replace(/\.tar\.gz$/, "");
      const files = (await fs.readdir(tmp, { recursive: true })) as string[];
      const found = files.find((f) => [exe(name), exe(archiveName)].includes(path.basename(f)));

      if (!found) throw new Error(`${name} not found inside ${url}`);

      staged = path.join(tmp, found);
    } else {
      await Bun.write(staged, bytes);
    }

    if (process.platform !== "win32") await fs.chmod(staged, 0o755);

    await fs.rename(staged, target);
    logger.log(`${name} installed at ${target}`);

    return target;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * dataPath/bin first, so an admin can drop in their own build, then our own
 * download. PATH only where there is nothing to download: distro packages are
 * routinely years old, and an old yt-dlp or ffmpeg rejects flags used here.
 */
const getBinary = (name: TBinary, logger: TLogger): Promise<string> => {
  let found = binaries.get(name);

  if (!found) {
    found = (async () => {
      const local = path.join(binDir, exe(name));

      if (await fs.exists(local)) return local;

      const fromPath = DOWNLOADS[`${process.platform}_${process.arch}`] ? null : Bun.which(name);

      return fromPath ?? (await download(name, logger));
    })();

    // a failed lookup is retried on the next call rather than cached
    found.catch(() => binaries.delete(name));
    binaries.set(name, found);
  }

  return found;
};

/**
 * The latest stable yt-dlp for this platform, pinned to the hash in that release's own SHA2-256SUMS.
 * Without a line for the file there is nothing to check it against, so the update is refused.
 */
const latestYtDlpPin = async (base = YT_DLP_LATEST): Promise<TPin> => {
  const pinned = DOWNLOADS[`${process.platform}_${process.arch}`]?.["yt-dlp"];

  if (!pinned) throw new Error(`No yt-dlp download for ${process.platform}_${process.arch}.`);

  const asset = path.posix.basename(pinned.url);
  const res = await fetch(`${base}SHA2-256SUMS`);

  if (!res.ok) throw new Error(`Fetching yt-dlp's SHA2-256SUMS failed: HTTP ${res.status}`);

  const line = (await res.text()).split("\n").find((l) => l.trim().split(/\s+/)[1]?.replace(/^\*/, "") === asset);
  const sha256 = line?.trim().split(/\s+/)[0];

  if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error(`yt-dlp's SHA2-256SUMS has no hash for ${asset}, so it wasn't updated.`);

  // ponytail: "latest" is looked up twice, so a release published in between fails the hash and
  // is refused; resolve the tag first if that ever bites
  return { url: `${base}${asset}`, sha256 };
};

/** YouTube changes faster than the pinned yt-dlp, so admins need a way to pull a fresh, checked one. */
const updateYtDlp = (logger: TLogger, base?: string) => {
  const updated = latestYtDlpPin(base).then((pin) => download("yt-dlp", logger, pin));

  binaries.set("yt-dlp", updated);
  updated.catch(() => binaries.delete("yt-dlp"));

  return updated;
};

// ---------------------------------------------------------------- yt-dlp

type TYtFormat = {
  url?: string;
  vcodec?: string;
  acodec?: string;
  http_headers?: Record<string, string>;
};

type TYtInfo = TYtFormat & {
  title?: string;
  thumbnail?: string;
  duration?: number;
  is_live?: boolean;
  requested_formats?: TYtFormat[];
};

const toInput = (f: TYtFormat): TInput | null => {
  // ffmpeg is told to read only these, so a page cannot point it at a local file
  if (!f.url || !HTTP_URL.test(f.url)) return null;

  return { url: f.url, headers: f.http_headers ?? {} };
};

/** Turns `yt-dlp -J` output into what ffmpeg needs. Pure, so it is tested on its own. */
const parseYtDlpInfo = (info: TYtInfo, sourceUrl: string): TMedia => {
  let video: TInput | null = null;
  let audio: TInput | null = null;

  if (info.requested_formats?.length) {
    // separate video and audio streams, the usual case on YouTube
    for (const f of info.requested_formats) {
      if (f.vcodec !== "none" && !video) video = toInput(f);
      else if (f.acodec !== "none" && !audio) audio = toInput(f);
    }
  } else {
    // a single file. A missing codec means yt-dlp did not probe it (a direct
    // link), so assume it has that track.
    const input = toInput(info);

    video = info.vcodec === "none" ? null : input;
    audio = info.acodec === "none" ? null : input;
  }

  if (!video && !audio) throw new Error("No playable video or audio was found at that link.");

  const duration = info.duration;

  return {
    // shown to every viewer, so cleaned of marks that could make it read as something else
    title: cleanTitle(info.title) || sourceUrl,
    thumbnailUrl: info.thumbnail && HTTP_URL.test(info.thumbnail) ? info.thumbnail : null,
    durationSec: !info.is_live && typeof duration === "number" && duration > 0 ? duration : null,
    video,
    audio,
  };
};

const RESOLVE_TIMEOUT_MS = 45_000;

type TResolveOptions = {
  maxHeight: number;
  /** the guard's url (proxy.ts): every request yt-dlp and ffmpeg make goes through it */
  guard: string;
  logger: TLogger;
  fallback?: boolean;
};

/** yt-dlp's arguments. Pure, so a test can check the guard is always there. */
const ytDlpArgs = (
  sourceUrl: string,
  opts: Omit<TResolveOptions, "logger"> & { cookies?: string; jsRuntime?: string },
): string[] => {
  const h = opts.maxHeight;

  return [
    "--dump-single-json",
    "--no-playlist",
    "--socket-timeout",
    "15",
    // YouTube's JS challenge unlocks its TV client. Some servers get 403s on that
    // client's links, so the fallback skips the challenge and gets another client.
    //
    // The challenge needs a JavaScript runtime, and a server rarely has `bun` on its PATH: Sharkord
    // is one compiled Bun program. So yt-dlp is pointed at that program, which runs as plain `bun`
    // with BUN_BE_BUN=1 (set where yt-dlp is started). Without it, yt-dlp finds no runtime, and
    // YouTube's links play from the start but refuse the range requests a seek or resume makes.
    ...(opts.fallback ? ["--no-js-runtimes", "--no-cache-dir"] : ["--js-runtimes", `bun:${opts.jsRuntime ?? process.execPath}`]),
    // h264/aac first: cheapest to decode, and the most widely supported
    "-f",
    `bv*[height<=${h}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`,
    ...(opts.cookies ? ["--cookies", opts.cookies] : []),
    // always: the guard keeps yt-dlp off the server's own network
    "--proxy",
    opts.guard,
    // ends option parsing, so a url can never be read as a flag
    "--",
    sourceUrl,
  ];
};

const resolveMedia = async (sourceUrl: string, opts: TResolveOptions): Promise<TMedia> => {
  if (!HTTP_URL.test(sourceUrl)) throw new Error("Paste an http(s) link.");

  const ytDlp = await getBinary("yt-dlp", opts.logger);
  const cookies = path.join(binDir, "cookies.txt");

  const proc = Bun.spawn(
    [ytDlp, ...ytDlpArgs(sourceUrl, { ...opts, cookies: (await fs.exists(cookies)) ? cookies : undefined })],
    // BUN_BE_BUN makes the Sharkord executable act as the `bun` CLI when yt-dlp runs it (see ytDlpArgs)
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_BE_BUN: "1" } },
  );

  const timer = setTimeout(() => proc.kill(), RESOLVE_TIMEOUT_MS);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code !== 0) {
      opts.logger.error("[yt-dlp]", stderr.trim());

      // "ERROR: ..." from extractors, "yt-dlp: error: ..." from bad options
      const reason = stderr.match(/^(?:ERROR|yt-dlp: error): (.*)$/m)?.[1];

      throw new Error(reason ? `Could not load that link: ${reason}` : "Could not load that link.");
    }

    // kept in the logs: when YouTube starts refusing, the reason is usually here
    for (const w of stderr.match(/^WARNING:.*$/gm) ?? []) opts.logger.log("[yt-dlp]", w);

    const info = JSON.parse(stdout) as TYtInfo;
    const media = parseYtDlpInfo(info, sourceUrl);

    // a direct file link: yt-dlp may know neither its tracks nor its length, so ask ffmpeg
    const unknownTracks = info.vcodec === undefined || info.acodec === undefined;
    const unknownLength = media.durationSec === null && !info.is_live;

    if (!info.requested_formats?.length && (unknownTracks || unknownLength)) {
      const input = media.video ?? media.audio!;
      const probed = parseProbe(await probe(await getBinary("ffmpeg", opts.logger), input, opts.guard));

      if (!probed.video && !probed.audio) throw new Error("No playable video or audio was found at that link.");

      media.video = probed.video ? input : null;
      media.audio = probed.audio ? input : null;
      if (!info.is_live) media.durationSec ??= probed.durationSec;
    }

    return media;
  } finally {
    clearTimeout(timer);
  }
};

/** `ffmpeg -i` with no output prints the streams and exits, which is all a probe needs */
const probe = async (ffmpeg: string, input: TInput, guard: string): Promise<string> => {
  const proc = Bun.spawn([ffmpeg, "-hide_banner", ...sourceArgs(input, guard), "-i", input.url], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 20_000);

  try {
    return await new Response(proc.stderr).text();
  } finally {
    clearTimeout(timer);
  }
};

const parseProbe = (stderr: string) => {
  const streams = stderr.split("\n").filter((l) => /^\s*Stream #/.test(l));
  const d = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;

  return {
    // cover art on an mp3 is a "video" stream of one frame: show black instead
    video: streams.some((l) => l.includes("Video:") && !l.includes("(attached pic)")),
    audio: streams.some((l) => l.includes("Audio:")),
    durationSec: durationSec > 0 ? durationSec : null,
  };
};

// ---------------------------------------------------------------- ffmpeg

const VIDEO_PT = 102;
const AUDIO_PT = 111;
/** must agree with the level x264 encodes at, see -level below */
const H264_PROFILE_LEVEL_ID = "42e028";

type TFfmpegOptions = {
  media: TMedia;
  startSec: number;
  maxHeight: number;
  videoBitrate: string;
  /** the guard's url (proxy.ts), which every fetch goes through */
  guard: string;
  rtpHost: string;
  videoPort: number;
  audioPort: number;
  videoSsrc: number;
  audioSsrc: number;
};

/** how ffmpeg opens a resolved url: http(s) only, with the site's headers */
const sourceArgs = (input: TInput, guard: string): string[] => {
  const headers = Object.entries(input.headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");

  return [
    "-protocol_whitelist",
    "http,https,tls,tcp,crypto,httpproxy",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    ...(headers ? ["-headers", headers] : []),
    // always: the guard keeps ffmpeg off the server's own network, and goes on through the admin's
    // proxy, since YouTube's media urls only work from the IP that resolved them
    "-http_proxy",
    guard,
  ];
};

const inputArgs = (input: TInput, startSec: number, guard: string): string[] => {
  return [
    ...sourceArgs(input, guard),
    // before -i: seeks the input instead of decoding up to the position
    ...(startSec > 0 ? ["-ss", startSec.toFixed(2)] : []),
    // paced to realtime, since this is a live stream to the viewers
    "-re",
    "-readrate_initial_burst",
    "0",
    "-i",
    input.url,
  ];
};

/**
 * One ffmpeg, two RTP outputs: H264 video and Opus audio into the two plain
 * transports. A source with only one track gets the other generated, so the
 * stream always has both producers and pause/seek can swap them as a pair.
 */
const buildFfmpegArgs = (o: TFfmpegOptions): string[] => {
  const { media } = o;
  const remaining = media.durationSec === null ? null : Math.max(1, media.durationSec - o.startSec);
  const args = ["-hide_banner", "-nostats", "-loglevel", "warning"];
  let inputs = 0;

  const add = (a: string[]) => {
    args.push(...a);

    return inputs++;
  };

  // a generated track lasts as long as the real one, so ffmpeg still ends with the media
  const generated = (graph: string) =>
    add([...(remaining ? ["-t", remaining.toFixed(2)] : []), "-re", "-f", "lavfi", "-i", graph]);

  const v = media.video ? add(inputArgs(media.video, o.startSec, o.guard)) : generated("color=c=black:s=640x360:r=25");
  const a =
    media.audio && media.audio === media.video
      ? v
      : media.audio
        ? add(inputArgs(media.audio, o.startSec, o.guard))
        : generated("anullsrc=r=48000:cl=stereo");

  const h = Math.min(1080, Math.max(144, Math.round(o.maxHeight)));

  args.push(
    "-map",
    `${v}:v:0`,
    // never upscale, even height for yuv420p, and level 4.0 holds up to 1080p25
    "-vf",
    `scale=-2:trunc(min(${h}\\,ih)/2)*2,fps=25,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline",
    "-level",
    "4.0",
    "-b:v",
    o.videoBitrate,
    "-maxrate",
    o.videoBitrate,
    "-bufsize",
    o.videoBitrate,
    // a keyframe every 2s: nothing feeds picture loss back over a plain transport,
    // so this is how a viewer who joins late gets a picture
    "-g",
    "50",
    "-keyint_min",
    "50",
    "-sc_threshold",
    "0",
    "-payload_type",
    String(VIDEO_PT),
    "-ssrc",
    String(o.videoSsrc),
    "-f",
    "rtp",
    `rtp://${o.rtpHost}:${o.videoPort}?pkt_size=1200`,

    "-map",
    `${a}:a:0`,
    "-af",
    "aresample=async=1",
    "-c:a",
    "libopus",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-b:a",
    "128k",
    "-payload_type",
    String(AUDIO_PT),
    "-ssrc",
    String(o.audioSsrc),
    "-f",
    "rtp",
    `rtp://${o.rtpHost}:${o.audioPort}?pkt_size=1200`,
  );

  return args;
};

export {
  AUDIO_PT,
  buildFfmpegArgs,
  download,
  getBinary,
  latestYtDlpPin,
  H264_PROFILE_LEVEL_ID,
  parseProbe,
  parseYtDlpInfo,
  resolveMedia,
  setBinDir,
  updateYtDlp,
  VIDEO_PT,
  ytDlpArgs,
};
export type { TMedia };
