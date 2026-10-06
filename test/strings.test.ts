import { expect, test } from "vitest";
import * as clientStrings from "../client/strings";
import * as text from "../server/core/text";

// The client bundle cannot import server/, so client/strings.ts repeats the
// instruction text. This test keeps the two copies equal.

test("client instruction text matches the server text", () => {
  expect(clientStrings.closeInstructions("TH-1", ["x"])).toBe(text.closeInstructions("TH-1", ["x"]));
  expect(clientStrings.startInstructions("TH-1")).toBe(text.startInstructions("TH-1"));
});

test("changesVs names the base, the file count and the uncommitted count", () => {
  expect(clientStrings.changesVs("origin/epic/E1-x", 12, 3)).toBe("changes vs origin/epic/E1-x: 12 files, 3 uncommitted");
});
