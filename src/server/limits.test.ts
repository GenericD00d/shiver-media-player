import { expect, test } from "bun:test";
import { canStartStream, createRateLimiter } from "./limits";

test("a member can play only so often, and the window slides", () => {
  let now = 0;
  const allow = createRateLimiter(2, 1000, () => now);

  expect(allow(1)).toBe(true);
  expect(allow(1)).toBe(true);
  expect(allow(1)).toBe(false);
  expect(allow(2)).toBe(true);

  now = 999;
  expect(allow(1)).toBe(false);

  now = 1000;
  expect(allow(1)).toBe(true);
});

test("the server plays in at most so many channels, and replacing a video adds none", () => {
  expect(canStartStream([], 1, 1)).toBe(true);
  expect(canStartStream([1], 1, 1)).toBe(true);
  expect(canStartStream([1], 2, 1)).toBe(false);
  expect(canStartStream([1, 2], 3, 3)).toBe(true);
  expect(canStartStream([1, 2, 3], 4, 3)).toBe(false);
});
