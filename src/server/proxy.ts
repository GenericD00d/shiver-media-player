import { once } from "events";
import net from "net";

/** http://, socks5:// or socks5h://, with optional user:pass@ */
const PROXY_URL = /^(http|socks5h?):\/\/[^\s/?#]+\/?$/i;

/** Waits for exact byte counts from a socket during a handshake. */
const reader = (sock: net.Socket) => {
  let buf = Buffer.alloc(0);
  let want: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;

  const pump = () => {
    if (!want || buf.length < want.n) return;

    const out = buf.subarray(0, want.n);
    const w = want;

    buf = buf.subarray(w.n);
    want = null;
    w.resolve(out);
  };
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    pump();
  };

  sock.on("data", onData);
  sock.once("close", () => want?.reject(new Error("The SOCKS proxy closed the connection.")));

  return {
    read: (n: number) =>
      new Promise<Buffer>((resolve, reject) => {
        want = { n, resolve, reject };
        pump();
      }),
    done: () => sock.off("data", onData),
  };
};

/** A TCP tunnel to host:port through a SOCKS5 proxy (RFC 1928, login per RFC 1929). DNS is resolved by the proxy. */
const socksConnect = async (proxy: URL, host: string, port: number): Promise<net.Socket> => {
  const sock = net.connect(Number(proxy.port) || 1080, proxy.hostname);

  try {
    await once(sock, "connect");

    const r = reader(sock);
    const user = Buffer.from(decodeURIComponent(proxy.username));
    const pass = Buffer.from(decodeURIComponent(proxy.password));

    sock.write(Buffer.from([5, 1, user.length ? 2 : 0]));

    const [, method] = await r.read(2);

    if (method === 2) {
      sock.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      if ((await r.read(2))[1] !== 0) throw new Error("The SOCKS proxy rejected the username or password.");
    } else if (method !== 0) {
      throw new Error("The SOCKS proxy wants a login method this plugin does not support.");
    }

    const h = Buffer.from(host);

    sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));

    const [, rep, , atyp] = await r.read(4);

    if (rep !== 0) throw new Error(`The SOCKS proxy could not reach ${host}:${port} (code ${rep}).`);

    // the bound address, unused: IPv4, IPv6 or a length-prefixed name, then the port
    await r.read(atyp === 1 ? 6 : atyp === 4 ? 18 : (await r.read(1))[0]! + 2);
    r.done();

    return sock;
  } catch (err) {
    sock.destroy();
    throw err;
  }
};

/**
 * ffmpeg only speaks HTTP proxies, so a SOCKS proxy gets a loopback HTTP proxy
 * in front of it: CONNECT for https, absolute-url requests for plain http.
 */
const startBridge = async (socksUrl: string) => {
  const proxy = new URL(socksUrl);

  const server = net.createServer((client) => {
    let head = Buffer.alloc(0);

    client.on("error", () => {});

    const onData = async (d: Buffer) => {
      head = Buffer.concat([head, d]);

      const end = head.indexOf("\r\n\r\n");

      if (end < 0) {
        if (head.length > 16_384) client.destroy();

        return;
      }

      client.off("data", onData);
      client.pause();

      const [method, target = ""] = head.subarray(0, head.indexOf("\r\n")).toString().split(" ");

      try {
        const connect = method === "CONNECT";
        const u = new URL(connect ? `https://${target}` : target);
        const port = Number(u.port) || (connect ? 443 : 80);
        const upstream = await socksConnect(proxy, u.hostname.replace(/^\[|\]$/g, ""), port);

        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());

        if (connect) {
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          upstream.write(head.subarray(end + 4));
        } else {
          // servers accept the absolute-url form, so the request goes on unchanged
          // ponytail: one upstream per connection, fine since ffmpeg opens a new one per request
          upstream.write(head);
        }

        client.pipe(upstream).pipe(client);
      } catch {
        client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
      }
    };

    client.on("data", onData);
  });

  // loopback only, so nothing outside the server can use it
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return { server, url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
};

let bridge: { socksUrl: string; ready: ReturnType<typeof startBridge> } | null = null;

const stopBridge = () => {
  bridge?.ready.then((b) => b.server.close()).catch(() => {});
  bridge = null;
};

/** The HTTP proxy ffmpeg should use for a proxy setting, or undefined for none. */
const ffmpegProxy = async (proxyUrl: string): Promise<string | undefined> => {
  if (!proxyUrl) return undefined;
  if (/^http:/i.test(proxyUrl)) return proxyUrl;

  if (bridge?.socksUrl !== proxyUrl) {
    stopBridge();
    bridge = { socksUrl: proxyUrl, ready: startBridge(proxyUrl) };
  }

  return (await bridge.ready).url;
};

export { ffmpegProxy, PROXY_URL, stopBridge };
