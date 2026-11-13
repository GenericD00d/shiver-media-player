import { afterAll, expect, test } from "bun:test";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { download, latestYtDlpPin, setBinDir } from "./media";

// a local download server, standing in for GitHub's release pages
const program = new TextEncoder().encode("#!/bin/sh\necho yt-dlp\n");
const sha256 = createHash("sha256").update(program).digest("hex");
const asset = process.platform === "win32" ? "yt-dlp.exe" : process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
let sums = "";
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => (new URL(req.url).pathname.endsWith("SHA2-256SUMS") ? new Response(sums) : new Response(program)),
});
const base = `http://127.0.0.1:${server.port}/latest/`;
const logger = { log: () => {}, error: () => {} };
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shiver-bin-"));
const target = path.join(dir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

setBinDir(dir);

afterAll(async () => {
  server.stop(true);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a download with the pinned hash is installed", async () => {
  expect(await download("yt-dlp", logger, { url: `${base}${asset}`, sha256 })).toBe(target);
  expect(await Bun.file(target).text()).toContain("echo yt-dlp");
  await fs.rm(target);
});

test("a download with any other hash is refused, and nothing is left behind", async () => {
  const wrong = "0".repeat(64);

  await expect(download("yt-dlp", logger, { url: `${base}${asset}`, sha256: wrong })).rejects.toThrow("isn't the expected file");
  expect(await fs.exists(target)).toBe(false);
  expect(await fs.readdir(dir)).toEqual([]);
});

test("an update needs a matching SHA2-256SUMS line", async () => {
  sums = `${"1".repeat(64)}  yt-dlp_macos\n`;
  await expect(latestYtDlpPin(base)).rejects.toThrow("no hash");

  sums = `${"1".repeat(64)}  yt-dlp_macos\n${sha256}  ${asset}\n`;
  expect(await latestYtDlpPin(base)).toEqual({ url: `${base}${asset}`, sha256 });
});

test("the pinned downloads are fixed releases with a hash each", async () => {
  const source = await Bun.file(path.join(import.meta.dir, "media.ts")).text();
  const pins = [...source.matchAll(/url: `\$\{(?:YT_DLP|FFMPEG)\}[^`]+`, sha256: "([0-9a-f]+)"/g)];

  expect(pins).toHaveLength(6);
  for (const [, hash] of pins) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(source).not.toMatch(/releases\/latest\/download\/(ffmpeg|yt-dlp)/);
  expect(source).not.toContain("nightly");
});
