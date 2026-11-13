import { expect, test } from "bun:test";
import { isPrivateAddress } from "./addresses";

// The same vectors as the companion plugin's tests in Shiver (plugin/test/plugin.test.js).

test("private and special addresses are refused in every spelling", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.88.99.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "::ffff:0:7f00:1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    "2001:0:4136:e378::1",
    "2001:db8::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "100::1",
    "[::1]",
    "not-an-address",
  ]) {
    expect(isPrivateAddress(address), address).toBe(true);
  }
});

test("public addresses are allowed", () => {
  for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "2002:5db8:d822::1"]) {
    expect(isPrivateAddress(address), address).toBe(false);
  }
});
