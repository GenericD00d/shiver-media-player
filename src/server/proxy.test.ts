import { afterAll, expect, test } from "bun:test";
import net from "net";
import { buildFfmpegArgs, parseYtDlpInfo, ytDlpArgs } from "./media";
import { PROXY_URL, startGuard, type TResolver } from "./proxy";
import { PRIVATE_VECTORS } from "./vectors";

// A public address stands in for every site: the stubs below record it and go to `web` instead,
// since nothing public is reachable from a test.
const PUBLIC = "93.184.216.34";
const web = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => new Response(`hi ${new URL(req.url).pathname}`) });
const toWeb = () => net.connect(web.port!, "127.0.0.1");

const resolve: TResolver = async (host) =>
  ({ "video.test": [PUBLIC], "mixed.test": [PUBLIC, "10.0.0.1"], "inside.test": ["192.168.1.10"] })[host] ?? [];

/** A bare SOCKS5 server that wants user "u" / pass "p" and records where it was asked to go. */
const socksTargets: string[] = [];
const socks = net.createServer((c) => {
  let step = 0;

  c.on("data", (chunk) => {
    const d = typeof chunk === "string" ? Buffer.from(chunk) : chunk;

    if (step === 0) {
      c.write(Buffer.from([5, 2]));
    } else if (step === 1) {
      c.write(Buffer.from([1, d.subarray(2, 2 + d[1]!).toString() === "u" ? 0 : 1]));
    } else if (step === 2) {
      // the guard only ever sends an address (type 1 or 4), never a name (type 3)
      expect(d[3]).toBe(1);
      socksTargets.push(`${[...d.subarray(4, 8)].join(".")}:${d.readUInt16BE(8)}`);

      const up = toWeb().on("connect", () => {
        c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        c.removeAllListeners("data");
        c.pipe(up).pipe(c);
      });
    }

    step++;
  });
});

/** A bare HTTP CONNECT proxy that records where it was asked to go. */
const httpTargets: string[] = [];
const httpUpstream = net.createServer((c) => {
  c.once("data", (d) => {
    httpTargets.push(d.toString().split(" ")[1]!);

    const up = toWeb().on("connect", () => {
      c.write("HTTP/1.1 200 Connection established\r\n\r\n");
      c.pipe(up).pipe(c);
    });
  });
});

socks.listen(0, "127.0.0.1");
httpUpstream.listen(0, "127.0.0.1");

const portOf = (s: net.Server) => (s.address() as net.AddressInfo).port;

let upstream = "";
const directTargets: string[] = [];
const guard = await startGuard({
  upstream: () => upstream,
  resolve,
  connect: async (ip, port) => {
    directTargets.push(`${ip}:${port}`);

    return toWeb();
  },
});

/** One raw request to the guard, the way yt-dlp and ffmpeg send them, with or without its login. */
function ask(request: string, login = true): Promise<string> {
  const { hostname, port, username, password } = new URL(guard.url);
  const auth = login ? `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n` : "";
  const [line, ...rest] = request.split("\r\n");

  return new Promise((done, fail) => {
    let response = "";
    const socket = net.connect(Number(port), hostname, () => socket.write([line, auth + rest.join("\r\n")].join("\r\n")));

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (response += chunk));
    socket.on("end", () => done(response));
    socket.on("error", fail);
  });
}

const get = (url: string, login = true) => ask(`GET ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\nConnection: close\r\n\r\n`, login);
const connect = (target: string) => ask(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);

afterAll(() => {
  guard.close();
  socks.close();
  httpUpstream.close();
  web.stop(true);
});

test("PROXY_URL", () => {
  for (const ok of ["http://h:8080", "socks5://u:p@h:1080", "SOCKS5H://h:1/"]) expect(PROXY_URL.test(ok)).toBe(true);
  for (const bad of ["", "h:8080", "https://h", "socks4://h:1", "http://h/path", "http://h x"]) expect(PROXY_URL.test(bad)).toBe(false);
});

test("the guard refuses every private address, as a literal and behind a name", async () => {
  const before = guard.refusals();

  for (const address of PRIVATE_VECTORS.filter((a) => net.isIP(a.replace(/^\[|\]$/g, "")))) {
    const target = address.includes(":") && !address.startsWith("[") ? `[${address}]:443` : `${address}:443`;

    expect(await connect(target), address).toStartWith("HTTP/1.1 403");
  }

  expect(await get("http://inside.test/")).toStartWith("HTTP/1.1 403");
  // one private address among public ones is enough to refuse
  expect(await connect("mixed.test:443")).toStartWith("HTTP/1.1 403");
  expect(guard.refusals()).toBeGreaterThan(before);
  expect(directTargets).toEqual([]);
});

test("the guard wants its own login", async () => {
  const response = await get("http://video.test/", false);

  expect(response).toStartWith("HTTP/1.1 407");
  expect(response).toContain('Proxy-Authenticate: Basic realm="shiver"');
  expect(directTargets).toEqual([]);
});

test("with no upstream, it connects straight to the address it checked", async () => {
  upstream = "";
  expect(await get("http://video.test/clip.mp4")).toEndWith("hi /clip.mp4");
  expect(directTargets.at(-1)).toBe(`${PUBLIC}:80`);
});

test("through an http upstream, it tunnels to the address it checked", async () => {
  upstream = `http://127.0.0.1:${portOf(httpUpstream)}`;
  expect(await get("http://video.test/a")).toEndWith("hi /a");
  expect(httpTargets).toEqual([`${PUBLIC}:80`]);
});

test("through a socks upstream, it sends the address it checked, never the name", async () => {
  upstream = `socks5h://u:p@127.0.0.1:${portOf(socks)}`;
  expect(await get("http://video.test/b")).toEndWith("hi /b");
  expect(socksTargets).toEqual([`${PUBLIC}:80`]);
  upstream = "";
});

test("every yt-dlp and ffmpeg argument list carries the guard", () => {
  const args = ytDlpArgs("https://video.test/watch", { maxHeight: 720, guard: guard.url });

  expect(args.slice(args.indexOf("--proxy"), args.indexOf("--proxy") + 2)).toEqual(["--proxy", guard.url]);
  expect(args.at(-2)).toBe("--");

  const media = parseYtDlpInfo(
    { requested_formats: [{ url: "https://v.test/v", vcodec: "avc1", acodec: "none" }, { url: "https://v.test/a", vcodec: "none", acodec: "mp4a" }] },
    "u",
  );
  const ffmpeg = buildFfmpegArgs({
    media,
    startSec: 0,
    maxHeight: 720,
    videoBitrate: "2500k",
    guard: guard.url,
    rtpHost: "127.0.0.1",
    videoPort: 1,
    audioPort: 2,
    videoSsrc: 1,
    audioSsrc: 2,
  });

  // one per input, before it
  expect(ffmpeg.filter((a) => a === "-http_proxy")).toHaveLength(2);
  expect(ffmpeg.filter((a) => a === "-i")).toHaveLength(2);
  expect(ffmpeg[ffmpeg.indexOf("-http_proxy") + 1]).toBe(guard.url);
});
