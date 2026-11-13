import { isIP } from "net";

/*
 * Which addresses the server may connect to on a member's behalf: global unicast only. A port of
 * isPrivateAddress in Shiver's companion plugin (plugin/server/index.js), the Shiver family's
 * reference (docs/standards.md, "Security baseline"). Keep the two, and their tests, in step.
 */

/** The eight 16-bit groups of an IPv6 address, or null. */
const ipv6Groups = (address: string): number[] | null => {
  if ((address.match(/::/g) ?? []).length > 1) return null;

  let text = address;
  const quad = text.match(/(\d+\.\d+\.\d+\.\d+)$/);

  if (quad) {
    const parts = quad[1]!.split(".").map(Number);

    if (parts.some((part) => !Number.isInteger(part) || part > 255)) return null;

    text =
      text.slice(0, -quad[1]!.length) +
      `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }

  const hasGap = text.includes("::");
  const [head = "", tail = ""] = text.split("::");
  const parse = (part: string) =>
    part ? part.split(":").map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN)) : [];
  const left = parse(head);
  const right = hasGap ? parse(tail) : [];
  const missing = 8 - left.length - right.length;

  if (missing < 0 || (!hasGap && missing !== 0)) return null;

  const groups = [...left, ...Array<number>(missing).fill(0), ...right];

  return groups.every(Number.isInteger) ? groups : null;
};

const isPrivateV4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts as [number, number, number, number];

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

/**
 * Allow-list: only global unicast (2000::/3) passes. Inside it, 6to4 is unwrapped and checked as
 * IPv4, and Teredo, documentation and ORCHID ranges are refused. Everything else (loopback,
 * IPv4-mapped and translated, NAT64, ULA, link and site-local, multicast) fails the first test.
 */
const isPrivateV6 = (address: string): boolean => {
  const groups = ipv6Groups(address);

  if (!groups) return true;

  const [first = 0, second = 0] = groups;

  if ((first & 0xe000) !== 0x2000) return true;

  if (first === 0x2002) {
    // 6to4: the IPv4 address is the two groups after 2002
    const [, high = 0, low = 0] = groups;

    return isPrivateV4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }

  return first === 0x2001 && (second === 0 || second === 0xdb8 || (second >= 0x10 && second <= 0x2f));
};

/** Whether the server must refuse to connect to this literal IP address. Anything else is refused too. */
const isPrivateAddress = (address: string): boolean => {
  const plain = String(address).toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(plain);

  if (family === 6) return isPrivateV6(plain);
  if (family === 4) return isPrivateV4(plain);

  return true;
};

export { isPrivateAddress };
