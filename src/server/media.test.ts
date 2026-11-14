import { expect, test } from "bun:test";
import { buildFfmpegArgs, parseProbe, parseYtDlpInfo, ytDlpArgs } from "./media";

const base = { maxHeight: 720, videoBitrate: "2500k", guard: "http://shiver:x@127.0.0.1:1", rtpHost: "127.0.0.1", videoPort: 1000, audioPort: 2000, videoSsrc: 1, audioSsrc: 2 };

test("separate youtube-style streams become two inputs, mapped apart", () => {
  const media = parseYtDlpInfo(
    {
      title: "Clip",
      duration: 100,
      requested_formats: [
        { url: "https://v.example/v", vcodec: "avc1", acodec: "none", http_headers: { Referer: "x" } },
        { url: "https://v.example/a", vcodec: "none", acodec: "mp4a" },
      ],
    },
    "https://src",
  );

  expect(media.video?.url).toBe("https://v.example/v");
  expect(media.audio?.url).toBe("https://v.example/a");

  const args = buildFfmpegArgs({ ...base, media, startSec: 30 }).join(" ");

  expect(args).toContain("-headers Referer: x\r\n");
  expect(args).toContain("-ss 30.00 -re -readrate_initial_burst 0 -i https://v.example/v");
  expect(args).toContain("-map 0:v:0");
  expect(args).toContain("-map 1:a:0");
});

test("a muxed file is read once and feeds both tracks", () => {
  const media = parseYtDlpInfo({ url: "https://x/f.mp4", duration: 10 }, "https://x/f.mp4");
  const args = buildFfmpegArgs({ ...base, media, startSec: 0 });

  expect(media.video).toBe(media.audio);
  expect(args.filter((a) => a === "-i")).toHaveLength(1);
  expect(args).not.toContain("-ss");
  expect(args.join(" ")).toContain("-map 0:a:0");
});

test("audio-only gets a black picture that ends with the audio", () => {
  const media = parseYtDlpInfo({ url: "https://x/a.mp3", vcodec: "none", duration: 60 }, "https://x/a.mp3");
  const args = buildFfmpegArgs({ ...base, media, startSec: 20 }).join(" ");

  expect(media.video).toBeNull();
  expect(args).toContain("-t 40.00 -re -f lavfi -i color=");
  expect(args).toContain("-map 1:a:0");
});

test("live streams have no duration and generated tracks never cut them off", () => {
  const media = parseYtDlpInfo({ url: "https://x/live.m3u8", acodec: "none", is_live: true, duration: 5 }, "u");
  const args = buildFfmpegArgs({ ...base, media, startSec: 0 }).join(" ");

  expect(media.durationSec).toBeNull();
  expect(args).toContain("-re -f lavfi -i anullsrc");
  expect(args).not.toContain("-t ");
});

test("non-http media urls are refused, so ffmpeg never reads local files", () => {
  expect(() => parseYtDlpInfo({ url: "file:///etc/passwd" }, "u")).toThrow();
});

test("probing a direct file reads its real tracks and length", () => {
  const silent = parseProbe(
    "  Duration: 00:01:10.50, start: 0.000000, bitrate: 800 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 640x360\n",
  );
  const mp3 = parseProbe(
    "  Duration: 01:00:00.00, bitrate: 128 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz\n  Stream #0:1: Video: mjpeg, 500x500 (attached pic)\n",
  );

  expect(silent).toEqual({ video: true, audio: false, durationSec: 70.5 });
  expect(mp3).toEqual({ video: false, audio: true, durationSec: 3600 });
  expect(parseProbe("  Duration: N/A\n").durationSec).toBeNull();
});

test("yt-dlp solves YouTube's challenge with the running executable as bun, unless falling back", () => {
  const opts = { maxHeight: 720, guard: "http://shiver:x@127.0.0.1:1" };
  const runtime = (args: string[]) => args[args.indexOf("--js-runtimes") + 1];

  expect(runtime(ytDlpArgs("https://y", opts))).toBe(`bun:${process.execPath}`);
  // a Windows path keeps its drive letter: yt-dlp splits RUNTIME:PATH at the first colon
  expect(runtime(ytDlpArgs("https://y", { ...opts, jsRuntime: "C:\Sharkord\sharkord.exe" }))).toBe("bun:C:\Sharkord\sharkord.exe");

  const fallback = ytDlpArgs("https://y", { ...opts, fallback: true });

  expect(fallback).toContain("--no-js-runtimes");
  expect(fallback).not.toContain("--js-runtimes");
});

test("seeks fetch bounded ranges, keyframes stay small, and IPv6 hosts get brackets", () => {
  const media = parseYtDlpInfo({ title: "x", duration: 600, url: "https://v.example/f", vcodec: "avc1", acodec: "mp4a" }, "https://src");
  const args = buildFfmpegArgs({ ...base, media, startSec: 300 }).join(" ");

  // without it ffmpeg reads up to the seek point at YouTube's throttled speed
  expect(args).toContain(`-request_size ${10 * 1024 * 1024} `);
  // 2500k over a fifth of a second
  expect(args).toContain("-bufsize 500000 ");
  expect(buildFfmpegArgs({ ...base, media, startSec: 0, videoBitrate: "2.5M" }).join(" ")).toContain("-bufsize 500000 ");
  expect(buildFfmpegArgs({ ...base, media, startSec: 0, rtpHost: "::1" }).join(" ")).toContain("rtp://[::1]:1000?");
});
