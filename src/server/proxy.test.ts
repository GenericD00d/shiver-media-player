import { afterAll, expect, test } from "bun:test";
import net from "net";
import { ffmpegProxy, PROXY_URL, stopBridge } from "./proxy";

/** A bare SOCKS5 server that wants user "u" / pass "p" and records where it was asked to go. */
const targets: string[] = [];
const socks = net.createServer((c) => {
  let step = 0;

  c.on("data", (d) => {
    if (step === 0) {
      c.write(Buffer.from([5, 2]));
    } else if (step === 1) {
      const ok = d.subarray(2, 2 + d[1]!).toString() === "u";

      c.write(Buffer.from([1, ok ? 0 : 1]));
    } else if (step === 2) {
      const host = d.subarray(5, 5 + d[4]!).toString();
      const port = d.readUInt16BE(5 + d[4]!);

      targets.push(`${host}:${port}`);

      const up = net.connect(port, host, () => {
        c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        c.removeAllListeners("data");
        c.pipe(up).pipe(c);
      });
    }

    step++;
  });
});

socks.listen(0, "127.0.0.1");

const web = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => new Response(`hi ${new URL(req.url).pathname}`) });

afterAll(() => {
  stopBridge();
  socks.close();
  web.stop(true);
});

test("PROXY_URL", () => {
  for (const ok of ["http://h:8080", "socks5://u:p@h:1080", "SOCKS5H://h:1/"]) expect(PROXY_URL.test(ok)).toBe(true);
  for (const bad of ["", "h:8080", "https://h", "socks4://h:1", "http://h/path", "http://h x"]) expect(PROXY_URL.test(bad)).toBe(false);
});

test("http proxies go to ffmpeg as-is", async () => {
  expect(await ffmpegProxy("")).toBeUndefined();
  expect(await ffmpegProxy("http://u:p@h:3128")).toBe("http://u:p@h:3128");
});

test("a socks proxy gets an http bridge that tunnels through it", async () => {
  const port = (socks.address() as net.AddressInfo).port;
  const bridge = await ffmpegProxy(`socks5://u:p@127.0.0.1:${port}`);

  expect(bridge).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  // absolute-url request, the way ffmpeg sends plain http through a proxy
  const res = await fetch(`http://localhost:${web.port}/video.mp4`, { proxy: bridge });

  expect(await res.text()).toBe("hi /video.mp4");
  expect(targets).toEqual([`localhost:${web.port}`]);
});
