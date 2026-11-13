import { expect, test } from "bun:test";
import { isPrivateAddress } from "./addresses";
import { PRIVATE_VECTORS, PUBLIC_VECTORS } from "./vectors";

test("private and special addresses are refused in every spelling", () => {
  for (const address of PRIVATE_VECTORS) expect(isPrivateAddress(address), address).toBe(true);
});

test("public addresses are allowed", () => {
  for (const address of PUBLIC_VECTORS) expect(isPrivateAddress(address), address).toBe(false);
});
