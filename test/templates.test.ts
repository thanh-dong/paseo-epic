import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { DEFAULT_EPIC_TEMPLATE, DEFAULT_HANDOFF_TEMPLATE } from "../server/core/default-templates";

// The default templates live in code (the daemon bundle cannot read files
// next to it); this test keeps them byte for byte equal to templates/.

test("the default template constants equal the shipped template files", () => {
  expect(DEFAULT_EPIC_TEMPLATE).toBe(readFileSync(new URL("../templates/epic.md", import.meta.url), "utf8"));
  expect(DEFAULT_HANDOFF_TEMPLATE).toBe(readFileSync(new URL("../templates/handoff.md", import.meta.url), "utf8"));
});
