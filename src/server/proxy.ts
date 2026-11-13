import { randomBytes, timingSafeEqual } from "crypto";
import dns from "dns/promises";
import { once } from "events";
import net from "net";
import { ipv6Groups, isPrivateAddress } from "./addresses";

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
  sock.once("close", () => want?.reject(new Error("The proxy closed the connection.")));

  return {
    read: (n: number) =>
      new Promise<Buffer>((resolve, reject) => {
        want = { n, resolve, reject };
        pump();
      }),
    /** everything up to and including the blank line that ends an HTTP head */
    head: async () => {
      let text = "";

      while (!text.includes("\r\n\r\n")) {
        if (text.length > 16_384) throw new Error("The proxy sent too long an answer.");
        text += (await r1()).toString("latin1");
      }

      return text;
    },
    done: () => sock.off("data", onData),
  };

  function r1() {
    return new Promise<Buffer>((resolve, reject) => {
      want = { n: 1, resolve, reject };
      pump();
    });
  }
};

/** SOCKS5's address field for an IP literal: IPv4 (1) or IPv6 (4). Names never get here. */
const socksAddress = (ip: string): Buffer => {
  if (net.isIPv4(ip)) return Buffer.from([1, ...ip.split(".").map(Number)]);

  const groups = ipv6Groups(ip)!;

  return Buffer.from([4, ...groups.flatMap((g) => [g >> 8, g & 255])]);
};

/** A TCP tunnel to ip:port through a SOCKS5 proxy (RFC 1928, login per RFC 1929). */
const socksConnect = async (proxy: URL, ip: string, port: number): Promise<net.Socket> => {
  const sock = net.connect(Number(proxy.port) || 1080, proxy.hostname.replace(/^\[|\]$/g, ""));

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

    sock.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(ip), Buffer.from([port >> 8, port & 255])]));

    const [, rep, , atyp] = await r.read(4);

    if (rep !== 0) throw new Error(`The SOCKS proxy could not reach ${ip}:${port} (code ${rep}).`);

    // the bound address, unused: IPv4, IPv6 or a length-prefixed name, then the port
    await r.read(atyp === 1 ? 6 : atyp === 4 ? 18 : (await r.read(1))[0]! + 2);
    r.done();

    return sock;
  } catch (err) {
    sock.destroy();
    throw err;
  }
};

/** A TCP tunnel to ip:port through an HTTP proxy, with CONNECT. */
const httpConnect = async (proxy: URL, ip: string, port: number): Promise<net.Socket> => {
  const sock = net.connect(Number(proxy.port) || 80, proxy.hostname.replace(/^\[|\]$/g, ""));

  try {
    await once(sock, "connect");

    const target = net.isIPv6(ip) ? `[${ip}]:${port}` : `${ip}:${port}`;
    const login = proxy.username
      ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}\r\n`
      : "";

    sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${login}\r\n`);

    const r = reader(sock);
    const status = (await r.head()).split(" ")[1];

    r.done();
    if (status !== "200") throw new Error(`The HTTP proxy could not reach ${target} (HTTP ${status}).`);

    return sock;
  } catch (err) {
    sock.destroy();
    throw err;
  }
};

type TResolver = (host: string) => Promise<string[]>;

const systemResolver: TResolver = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Thrown for a host that is, or resolves to, an address on the server's own network. */
class RefusedAddress extends Error {}

/**
 * The one address to connect to for host: every address it resolves to must be public, and the
 * connection goes to one of those, never to a second lookup that could answer differently.
 */
const checkedAddress = async (host: string, resolve: TResolver): Promise<string> => {
  const plain = host.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(plain) ? [plain] : await resolve(plain).catch(() => []);

  if (!addresses.length) throw new Error(`Could not resolve ${plain}.`);
  if (addresses.some(isPrivateAddress)) throw new RefusedAddress(`${plain} is on the server's own network.`);

  return addresses[0]!;
};

type TGuardOptions = {
  /** the admin's proxy setting, read on every request: "" for none */
  upstream: () => string;
  resolve?: TResolver;
  /** how a direct connection is made; a test replaces it, since public addresses aren't local */
  connect?: (ip: string, port: number) => Promise<net.Socket>;
};

const directConnect = async (ip: string, port: number) => {
  const sock = net.connect(port, ip);

  await once(sock, "connect");

  return sock;
};

/**
 * The guard: an HTTP proxy on loopback that every yt-dlp and ffmpeg run goes through. It takes
 * CONNECT for https and absolute URLs for plain http, refuses anything that is or resolves to an
 * address on the server's own network, and connects only to the address it checked, directly or
 * through the admin's proxy. It wants its own password, new on every load, so other programs on
 * the server can't use it to reach what it guards.
 */
const startGuard = async (opts: TGuardOptions) => {
  const resolve = opts.resolve ?? systemResolver;
  const password = randomBytes(18).toString("base64url");
  const expected = Buffer.from(`Basic ${Buffer.from(`shiver:${password}`).toString("base64")}`);
  let refusals = 0;

  const authorised = (head: string) => {
    const given = Buffer.from(head.match(/^proxy-authorization:\s*(.*?)\s*$/im)?.[1] ?? "");

    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  const tunnel = async (ip: string, port: number): Promise<net.Socket> => {
    const up = opts.upstream();

    if (!up) return (opts.connect ?? directConnect)(ip, port);

    const proxy = new URL(up);

    // ponytail: plain http goes through an http upstream with CONNECT too, which some proxies
    // allow only to port 443; forward the absolute-URL request instead if that bites
    return /^http:/i.test(up) ? httpConnect(proxy, ip, port) : socksConnect(proxy, ip, port);
  };

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

      const text = head.subarray(0, end).toString("latin1");
      const [method, target = ""] = text.slice(0, text.indexOf("\r\n")).split(" ");

      if (!authorised(text)) {
        // ffmpeg sends its login only once challenged
        client.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="shiver"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        );

        return;
      }

      try {
        const connect = method === "CONNECT";
        const u = new URL(connect ? `https://${target}` : target);

        if (!connect && u.protocol !== "http:") throw new Error(`${u.protocol} isn't proxied.`);

        const port = Number(u.port) || (connect ? 443 : 80);
        const ip = await checkedAddress(u.hostname, resolve);
        const upstream = await tunnel(ip, port);

        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());

        if (connect) {
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          upstream.write(head.subarray(end + 4));
        } else {
          // the login to the guard stays here; servers accept the absolute-URL form
          upstream.write(head.toString("latin1").replace(/^proxy-authorization:.*\r\n/im, ""));
          // ponytail: one upstream per connection, fine since a later request on it still only
          // reaches the address that was checked
        }

        client.pipe(upstream).pipe(client);
      } catch (err) {
        const refused = err instanceof RefusedAddress;

        if (refused) refusals++;
        client.end(`HTTP/1.1 ${refused ? "403 Forbidden" : "502 Bad Gateway"}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      }
    };

    client.on("data", onData);
  });

  // loopback only, and the password keeps other local programs out
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://shiver:${password}@127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    /** how many requests have been refused for their address, so a failed run can say why */
    refusals: () => refusals,
    close: () => server.close(),
  };
};

type TGuard = Awaited<ReturnType<typeof startGuard>>;

export { PROXY_URL, startGuard };
export type { TGuard, TResolver };
