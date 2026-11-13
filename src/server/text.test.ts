import { expect, test } from "bun:test";
import { cleanTitle } from "./text";

test("titles lose invisible and direction marks, and controls become spaces", () => {
  expect(cleanTitle("Holiday\u202e4pm.exe")).toBe("Holiday4pm.exe");
  expect(cleanTitle("a\u200bb\u2066c\u2069")).toBe("abc");
  expect(cleanTitle("one\ntwo\u2028three")).toBe("one two three");
});

test("an empty or missing title is null, and a long one is capped by character", () => {
  expect(cleanTitle(undefined)).toBeNull();
  expect(cleanTitle("  \u200b ")).toBeNull();
  expect(cleanTitle("a".repeat(5) + "\ud83d\ude00\ud83d\ude00", 6)).toBe("aaaaa\ud83d\ude00");
});
