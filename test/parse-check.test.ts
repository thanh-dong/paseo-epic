import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { checkPackage, epicBranch, renderStatus } from "../server/core/check";
import { parseEpic, parseHandoff } from "../server/core/parse";
import { slugify } from "../server/core/slug";
import { fill, initE99, LEDGER_901, makeRoot, ROWS, TODAY } from "./fixtures";

let tmp: string;
let root: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "paseo-epic-"));
  root = makeRoot(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function load(dir: string) {
  const f = join(dir, "EPIC.md");
  const h = join(dir, "HANDOFF.md");
  return {
    e: parseEpic(f, readFileSync(f, "utf8")),
    h: existsSync(h) ? parseHandoff(readFileSync(h, "utf8")) : null,
  };
}

test("templatePackagePassesCheck", () => {
  const { e, h } = load(initE99(root));
  expect(e.id).toBe("E99");
  expect(epicBranch(e)).toBe("epic/E99-test-epic");
  expect(checkPackage(e, h)).toEqual([]);
  expect(e.text).toContain("# E99 — Test epic");
  expect(h?.text).toContain(`written=${TODAY}`);
});

test("filledPackagePassesAndRenderIsStable", () => {
  const { e, h } = load(fill(root));
  expect(e.rows.map((r) => r.id)).toEqual(["TH-901", "TH-902", "TH-903"]);
  expect(e.ledger).toEqual([{ id: "TH-901", date: "2026-09-06" }]);
  expect(e.status.State).toBe("in_progress");
  expect(e.status.Stories).toBe("1 of 3 implemented");
  expect(e.status.Next).toBe("TH-902");
  expect(checkPackage(e, h)).toEqual([]);
  expect(renderStatus(e)).toBe(e.text);
});

test("implementedWithoutLedgerFails", () => {
  const { e, h } = load(fill(root, { ledger: "", after: "none" }));
  const problems = checkPackage(e, h);
  expect(problems.some((p) => p.includes("no `### TH-901")), problems.join("\n")).toBe(true);
});

test("handTypedStatusDriftIsReported", () => {
  const d = fill(root);
  const f = join(d, "EPIC.md");
  writeFileSync(
    f,
    readFileSync(f, "utf8")
      .replaceAll("Stories: 1 of 3 implemented", "Stories: 2 of 3 implemented")
      .replaceAll("Next: TH-902", "Next: TH-903"),
  );
  const { e, h } = load(d);
  const problems = checkPackage(e, h);
  expect(
    problems.some((p) => p.includes("Stories `2 of 3 implemented` should be `1 of 3 implemented`")),
    problems.join("\n"),
  ).toBe(true);
  expect(
    problems.some((p) => p.includes("Next `TH-903` should be `TH-902`")),
    problems.join("\n"),
  ).toBe(true);
});

test("handoffHeaderMustMatchLedgerAndNext", () => {
  const { e, h } = load(fill(root, { after: "TH-902", next: "TH-903" }));
  const problems = checkPackage(e, h);
  expect(
    problems.some((p) => p.includes("after=TH-902 but the last ledger entry is TH-901")),
    problems.join("\n"),
  ).toBe(true);
  expect(
    problems.some((p) => p.includes("next=TH-903 but the next open story is TH-902")),
    problems.join("\n"),
  ).toBe(true);
});

test("handoffMissingHeadingFails", () => {
  const d = fill(root);
  const hf = join(d, "HANDOFF.md");
  writeFileSync(hf, readFileSync(hf, "utf8").replaceAll("## 5. Gotchas", "## Gotchas"));
  const { e, h } = load(d);
  const problems = checkPackage(e, h);
  expect(problems.some((p) => p.includes("heading `## 5. …` missing")), problems.join("\n")).toBe(
    true,
  );
});

test("closedEpicHasNextNone", () => {
  const rows = ROWS.replaceAll("| planned | |", "| implemented | 2026-09-06 PR #2 |");
  const ledger = `${LEDGER_901}\n### TH-902 — 2026-09-06\n\n- x\n\n### TH-903 — 2026-09-06\n\n- x\n`;
  const { e, h } = load(fill(root, { rows, ledger, after: "TH-903", next: "none" }));
  expect(e.status.State).toBe("closed");
  expect(checkPackage(e, h)).toEqual([]);
});

test("slugify handles unicode, punctuation, and length", () => {
  expect(slugify("Ünïcode & punctuation!!")).toBe("n-code-punctuation");
  expect(slugify("x".repeat(60))).toHaveLength(48);
  expect(slugify("---")).toBe("story");
});
