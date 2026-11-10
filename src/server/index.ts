import {
  Permission,
  PluginSlot,
  type AppData,
  type PlainTransport,
  type PluginContext,
  type TExternalStreamHandle,
  type TInvokerContext,
} from "@sharkord/plugin-sdk";
import path from "path";
import type { TPlayerState, TSharkord } from "../contract";
import {
  AUDIO_PT,
  buildFfmpegArgs,
  getBinary,
  H264_PROFILE_LEVEL_ID,
  resolveMedia,
  setBinDir,
  updateYtDlp,
  VIDEO_PT,
  type TMedia,
} from "./media";
import { ffmpegProxy, PROXY_URL, stopBridge } from "./proxy";

type TCtx = PluginContext<TSharkord>;

/** One video in one voice channel. Channels never share a session. */
type TSession = {
  channelId: number;
  url: string;
  startedByUserId: number;
  media: TMedia | null;
  resolvedAt: number;
  status: "loading" | "playing" | "paused";
  /** the position when playback last (re)started or paused */
  offsetSec: number;
  /** Date.now() when the running ffmpeg started, null while paused */
  playingSince: number | null;
  proc: Bun.Subprocess | null;
  transports: PlainTransport<AppData>[];
  stream: TExternalStreamHandle | null;
  /** every restart runs through here, so spammed pause/seek clicks apply in order */
  chain: Promise<unknown>;
  closed: boolean;
  /** set after a 403 until playback starts again: the link is re-fetched once, the fallback way, not forever */
  retried: boolean;
};

// signed media urls (YouTube's last about 6h) are fetched again after this
const RESOLVE_TTL_MS = 60 * 60 * 1000;

const IDLE: TPlayerState = {
  status: "idle",
  url: null,
  title: null,
  thumbnailUrl: null,
  durationSec: null,
  positionSec: 0,
  startedByUserId: null,
};

const sessions = new Map<number, TSession>();
let ctx: TCtx | null = null;
let settings: { maxHeight: () => number; videoBitrate: () => string; proxy: () => string } | null = null;

const positionOf = (s: TSession): number => {
  const p = s.offsetSec + (s.playingSince ? (Date.now() - s.playingSince) / 1000 : 0);
  const d = s.media?.durationSec;

  return d ? Math.min(p, d) : p;
};

const snapshot = (s: TSession | undefined): TPlayerState =>
  s
    ? {
        status: s.status,
        url: s.url,
        title: s.media?.title ?? null,
        thumbnailUrl: s.media?.thumbnailUrl ?? null,
        durationSec: s.media?.durationSec ?? null,
        positionSec: positionOf(s),
        startedByUserId: s.startedByUserId,
      }
    : IDLE;

const publish = (channelId: number) => {
  ctx?.push.toVoiceChannel(channelId, { channelId, state: snapshot(sessions.get(channelId)) });
};

const streamTitle = (s: TSession) => `${s.status === "paused" ? "⏸" : "▶"} ${s.media?.title ?? s.url}`;

const killProc = (s: TSession) => {
  const proc = s.proc;

  // cleared first, so its exit handler knows it was stopped on purpose
  s.proc = null;
  proc?.kill();
};

const endSession = (channelId: number) => {
  const s = sessions.get(channelId);

  if (!s) return;

  s.closed = true;
  sessions.delete(channelId);
  killProc(s);

  try {
    s.stream?.remove();
  } catch {}

  for (const t of s.transports) t.close();

  publish(channelId);
};

const run = <T>(s: TSession, op: () => Promise<T>): Promise<T> => {
  const next = s.chain.then(op);

  s.chain = next.catch(() => {});

  return next;
};

/**
 * (Re)starts playback at `sec`. ffmpeg can only seek by restarting, and a
 * plain transport with comedia locks onto the first sender's port, so every
 * restart gets fresh transports and producers, swapped into the same stream.
 */
const startAt = async (s: TSession, sec: number) => {
  const c = ctx!;
  const logger = c.logger;

  killProc(s);
  s.status = "loading";
  s.playingSince = null;
  s.offsetSec = sec;
  publish(s.channelId);

  if (!s.media || Date.now() - s.resolvedAt > RESOLVE_TTL_MS) {
    s.media = await resolveMedia(s.url, { maxHeight: settings!.maxHeight(), proxy: settings!.proxy(), logger, fallback: s.retried });
    s.resolvedAt = Date.now();
  }

  const ffmpeg = await getBinary("ffmpeg", logger);
  const httpProxy = await ffmpegProxy(settings!.proxy());

  if (s.closed) return;

  // throws when nobody is in the channel any more
  const router = c.voice.getRouter(s.channelId);
  const { ip, announcedAddress } = c.voice.getListenInfo();
  const transport = (rtcpMux: boolean) =>
    router.createPlainTransport({
      listenInfo: { ip, protocol: "udp", announcedAddress },
      rtcpMux,
      comedia: true,
      enableSrtp: false,
    });

  const [vt, at] = await Promise.all([transport(false), transport(true)]);
  const videoSsrc = 1 + Math.floor(Math.random() * 0xfffffffe);
  const audioSsrc = 1 + Math.floor(Math.random() * 0xfffffffe);

  const [video, audio] = await Promise.all([
    vt.produce({
      kind: "video",
      rtpParameters: {
        codecs: [
          {
            mimeType: "video/H264",
            payloadType: VIDEO_PT,
            clockRate: 90_000,
            parameters: {
              "packetization-mode": 1,
              "profile-level-id": H264_PROFILE_LEVEL_ID,
              "level-asymmetry-allowed": 1,
            },
            rtcpFeedback: [],
          },
        ],
        encodings: [{ ssrc: videoSsrc }],
      },
    }),
    at.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [
          { mimeType: "audio/opus", payloadType: AUDIO_PT, clockRate: 48_000, channels: 2, parameters: {}, rtcpFeedback: [] },
        ],
        encodings: [{ ssrc: audioSsrc }],
      },
    }),
  ]);

  if (s.closed) {
    vt.close();
    at.close();

    return;
  }

  const old = s.transports;

  s.transports = [vt, at];

  if (s.stream) {
    // the host closes the old producers itself, one track at a time, so the stream survives the swap
    s.stream.update({ title: streamTitle(s), producers: { video, audio } });
  } else {
    s.stream = c.voice.createStream({
      channelId: s.channelId,
      key: "shiver",
      title: streamTitle(s),
      bannerUrl: s.media.thumbnailUrl ?? undefined,
      producers: { video, audio },
    });
  }

  for (const t of old) t.close();

  const proc = Bun.spawn(
    [
      ffmpeg,
      ...buildFfmpegArgs({
        media: s.media,
        startSec: sec,
        maxHeight: settings!.maxHeight(),
        videoBitrate: settings!.videoBitrate(),
        httpProxy,
        rtpHost: ip,
        videoPort: vt.tuple.localPort,
        audioPort: at.tuple.localPort,
        videoSsrc,
        audioSsrc,
      }),
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );

  // read as it comes, so a chatty ffmpeg never blocks on a full pipe
  const stderr = new Response(proc.stderr).text();

  s.proc = proc;

  // comedia reports the sender on its first packet: that, not the spawn, is when
  // viewers start seeing frames, so the clock starts here and pause/resume never drifts
  vt.once("tuple", () => {
    if (s.proc !== proc) return;

    s.playingSince = Date.now();
    s.status = "playing";
    s.retried = false;
    publish(s.channelId);
  });

  proc.exited.then(async (code) => {
    // paused, seeked or stopped: someone else owns the channel now
    if (s.proc !== proc) return;

    const log = (await stderr).trim();

    // YouTube refused the link (stale, or its player code cached wrong): fetch a fresh one once
    if (code !== 0 && / 403 /.test(log) && !s.retried && !s.closed) {
      logger.log(`Got HTTP 403 in channel ${s.channelId}, fetching a fresh link and retrying`);
      s.retried = true;
      s.media = null;
      restart(s, positionOf(s)).catch(() => {});

      return;
    }

    if (code === 0) logger.log(`Finished "${s.media?.title}" in channel ${s.channelId}`);
    else logger.error(`ffmpeg exited with code ${code} in channel ${s.channelId}`, log);

    endSession(s.channelId);
  });
};

const channelOf = (invoker: TInvokerContext): number => {
  if (!invoker.currentVoiceChannelId) throw new Error("Join a voice channel first.");

  return invoker.currentVoiceChannelId;
};

const sessionOf = (invoker: TInvokerContext): TSession => {
  const s = sessions.get(channelOf(invoker));

  if (!s) throw new Error("Nothing is playing in this channel.");

  return s;
};

/** a failed restart ends the session, so nobody is left with a stream that never plays */
const restart = async (s: TSession, sec: number) => {
  try {
    await run(s, () => startAt(s, sec));
  } catch (err) {
    // an Error logs as {}, so the message is passed on its own
    ctx?.logger.error(`Playback failed in channel ${s.channelId}:`, err instanceof Error ? err.message : err);
    endSession(s.channelId);
    throw err;
  }
};

const onLoad = async (c: TCtx) => {
  ctx = c;
  setBinDir(path.join(c.dataPath, "bin"));

  // fetched in the background, so the first play does not wait on a download
  getBinary("ffmpeg", c.logger).catch((err) => c.logger.error("ffmpeg unavailable:", String(err)));
  getBinary("yt-dlp", c.logger).catch((err) => c.logger.error("yt-dlp unavailable:", String(err)));

  const s = await c.settings.register([
    {
      key: "maxHeight",
      name: "Max video height",
      description: "Videos are scaled down to this many pixels tall (144-1080). Higher costs more CPU and bandwidth.",
      type: "number",
      defaultValue: 720,
    },
    {
      key: "videoBitrate",
      name: "Video bitrate",
      description: "Bitrate of the stream sent to viewers, e.g. 2500k. Your server's upload limits how high this can go.",
      type: "string",
      defaultValue: "2500k",
    },
    {
      key: "proxy",
      name: "Proxy (optional)",
      description:
        "Fetch videos through a proxy, e.g. when a site blocks the server's IP. http://host:port or socks5://host:port, optionally with user:pass@. Leave empty for none.",
      type: "string",
      defaultValue: "",
    },
  ] as const);

  settings = {
    maxHeight: () => s.get("maxHeight") || 720,
    videoBitrate: () => (/^\d+(\.\d+)?[kKmM]?$/.test(s.get("videoBitrate").trim()) ? s.get("videoBitrate").trim() : "2500k"),
    proxy: () => {
      const p = s.get("proxy").trim();

      // refused rather than ignored, so a typo never quietly falls back to the server's own IP
      if (p && !PROXY_URL.test(p)) throw new Error("The proxy setting is invalid. Use http://host:port or socks5://host:port.");

      return p;
    },
  };

  c.ui.enable({
    [PluginSlot.VOICE_CONTROLS]: Permission.JOIN_VOICE_CHANNELS,
    [PluginSlot.TOPBAR_RIGHT]: Permission.JOIN_VOICE_CHANNELS,
  });

  c.events.on("voice:runtime_closed", ({ channelId }) => endSession(channelId));

  // nobody left to watch: stop transcoding
  c.events.on("user:left_voice", ({ channelId }) => {
    try {
      if (c.voice.getState(channelId).users.length === 0) endSession(channelId);
    } catch {
      endSession(channelId);
    }
  });

  c.actions.register({
    name: "getState",
    description: "What is playing in the caller's voice channel",
    executes: async (invoker) => snapshot(sessions.get(invoker.currentVoiceChannelId ?? -1)),
  });

  c.actions.register({
    name: "play",
    description: "Plays a link in the caller's voice channel, replacing what was on",
    requires: Permission.JOIN_VOICE_CHANNELS,
    executes: async (invoker, { url }) => {
      const channelId = channelOf(invoker);
      const trimmed = String(url ?? "").trim();

      if (!/^https?:\/\/\S+$/i.test(trimmed) || trimmed.length > 2048) {
        throw new Error("Paste a full http(s) link.");
      }

      endSession(channelId);

      const session: TSession = {
        channelId,
        url: trimmed,
        startedByUserId: invoker.userId,
        media: null,
        resolvedAt: 0,
        status: "loading",
        offsetSec: 0,
        playingSince: null,
        proc: null,
        transports: [],
        stream: null,
        chain: Promise.resolve(),
        closed: false,
        retried: false,
      };

      sessions.set(channelId, session);
      await restart(session, 0);

      return snapshot(session);
    },
  });

  c.actions.register({
    name: "pause",
    description: "Pauses the video for everyone in the channel",
    requires: Permission.JOIN_VOICE_CHANNELS,
    executes: async (invoker) => {
      const s = sessionOf(invoker);

      await run(s, async () => {
        if (s.status === "paused") return;

        s.offsetSec = positionOf(s);
        s.playingSince = null;
        killProc(s);
        s.status = "paused";
        s.stream?.update({ title: streamTitle(s) });
        publish(s.channelId);
      });

      return snapshot(s);
    },
  });

  c.actions.register({
    name: "resume",
    description: "Resumes the video for everyone in the channel",
    requires: Permission.JOIN_VOICE_CHANNELS,
    executes: async (invoker) => {
      const s = sessionOf(invoker);

      if (s.status === "paused") await restart(s, s.offsetSec);

      return snapshot(s);
    },
  });

  c.actions.register({
    name: "seek",
    description: "Jumps to a position for everyone in the channel",
    requires: Permission.JOIN_VOICE_CHANNELS,
    executes: async (invoker, { positionSec }) => {
      const s = sessionOf(invoker);
      const duration = s.media?.durationSec;

      if (!duration) throw new Error("Live streams cannot be seeked.");
      if (!Number.isFinite(positionSec)) throw new Error("Invalid position.");

      const sec = Math.min(Math.max(0, positionSec), Math.max(0, duration - 1));

      const paused = await run(s, async () => {
        if (s.status !== "paused") return false;

        s.offsetSec = sec;
        publish(s.channelId);

        return true;
      });

      if (!paused) await restart(s, sec);

      return snapshot(s);
    },
  });

  c.actions.register({
    name: "stop",
    description: "Stops the video and removes it from the channel",
    requires: Permission.JOIN_VOICE_CHANNELS,
    executes: async (invoker) => {
      endSession(channelOf(invoker));

      return IDLE;
    },
  });

  c.commands.register({
    name: "shiver-update-yt-dlp",
    description: "Downloads the latest yt-dlp, for when a site stops working",
    requires: Permission.MANAGE_PLUGINS,
    ephemeral: true,
    executes: async () => {
      updateYtDlp(c.logger).catch((err) => c.logger.error("yt-dlp update failed:", String(err)));

      return "Downloading the latest yt-dlp. Follow it in the plugin logs.";
    },
  });

  c.logger.log("Shiver Media Player loaded");
};

const onUnload = () => {
  for (const channelId of [...sessions.keys()]) endSession(channelId);
  stopBridge();

  ctx = null;
};

export { onLoad, onUnload };
