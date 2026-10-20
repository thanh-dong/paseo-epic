import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadConfig } from "../server/core/config";
import { epicBranch, findEpicDir, loadLocal } from "../server/core/locate";
import { ledgerEntry, parseEpic, parseHandoff, rowOf, storyOfName } from "../server/core/parse";
import { slugify } from "../server/core/slug";
import { fill, initE99, makeRoot, TODAY } from "./fixtures";

let tmp: string;
let root: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "paseo-epic-"));
  root = makeRoot(tmp);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("the template package reads: id from the folder, title from the H1, the epic branch from the prefix", async () => {
  const d = await initE99(root);
  const { epic, handoff } = loadLocal(d);
  expect(epic.id).toBe("E99");
  expect(epic.title).toBe("Test epic");
  expect(epicBranch(loadConfig(root), d)).toBe("epic/E99-test-epic");
  expect(epicBranch({ ...loadConfig(root), epicBranchPrefix: "epics/" }, d)).toBe("epics/E99-test-epic");
  // The template's placeholder row is read like any row; the commented ledger example is not an entry.
  expect(epic.rows.map((r) => r.id)).toEqual(["S-1"]);
  expect(ledgerEntry(epic.text, "S-1")).toBe("");
  expect(epic.status.Branch).toBe("epic/E99-test-epic");
  expect(handoff?.found).toBe(true);
  expect(handoff?.next).toBe("none");
  expect(handoff?.text).toContain(`written=${TODAY}`);
});

test("story ids of any shape are rows, and findEpicDir finds them", async () => {
  const rows = [
    "| TH-E10-1 First | One. | normal | planned | |",
    "| story-7 Second | Two. | normal | planned | |",
    "| ABC | Three. | high-risk | planned | |",
  ].join("\n");
  const d = await fill(root, { rows, ledger: "", after: "none", next: "TH-E10-1" });
  const { epic } = loadLocal(d);
  expect(epic.rows.map((r) => [r.id, r.title, r.lane])).toEqual([
    ["TH-E10-1", "First", "normal"],
    ["story-7", "Second", "normal"],
    ["ABC", "", "high-risk"],
  ]);
  const cfg = loadConfig(root);
  for (const ref of ["E99", "story-7", "ABC", "E99-test-epic"]) expect(findEpicDir(root, cfg, ref)).toBe(d);
  expect(() => findEpicDir(root, cfg, "nope")).toThrow("`nope` is not an epic id, a story in a story list, or a folder");
});

test("a table header that is not `Story` is not read as a row", () => {
  const text = "## Story list\n\n| Id | What | Lane | Status |\n| --- | --- | --- | --- |\n| A-1 Thing | x | normal | planned |\n";
  expect(parseEpic("/x/E1-y/EPIC.md", text).rows.map((r) => r.id)).toEqual(["A-1"]);
});

test("rows inside a comment block are skipped", () => {
  const text = "## Story list\n\n<!--\n| B-1 Old | x | normal | planned | |\n-->\n| B-2 New | x | normal | planned | |\n";
  expect(parseEpic("/x/E1-y/EPIC.md", text).rows.map((r) => r.id)).toEqual(["B-2"]);
});

test("the H1 without an id gives the whole H1 as the title; no H1 gives none", () => {
  expect(parseEpic("/x/E1-y/EPIC.md", "# Just a title\n").title).toBe("Just a title");
  expect(parseEpic("/x/E1-y/EPIC.md", "no heading\n").title).toBe("");
});

test("a commented ledger example is never the entry, and a comment after an entry is not part of it", () => {
  const text = [
    "## Ledger",
    "",
    "<!--",
    "### TH-NNN — YYYY-MM-DD",
    "",
    "- example",
    "-->",
    "",
    "### TH-901 — 2026-09-06",
    "",
    "- Shipped: one.",
    "<!-- a note for the next agent -->",
    "",
    "## Dependencies",
  ].join("\n");
  expect(ledgerEntry(text, "TH-NNN")).toBe("");
  expect(ledgerEntry(text, "TH-901")).toBe("### TH-901 — 2026-09-06\n\n- Shipped: one.");
});

test("the handoff header gives after and next", async () => {
  const d = await fill(root);
  const h = parseHandoff(readFileSync(join(d, "HANDOFF.md"), "utf8"));
  expect([h.found, h.epic, h.after, h.next]).toEqual([true, "E99", "TH-901", "TH-902"]);
  expect(parseHandoff("no header").found).toBe(false);
  expect(rowOf(loadLocal(d).epic, "TH-902")?.title).toBe("Second thing");
});

test("slugify handles unicode, punctuation, and length", () => {
  expect(slugify("Ünïcode & punctuation!!")).toBe("n-code-punctuation");
  expect(slugify("x".repeat(60))).toHaveLength(48);
  expect(slugify("---")).toBe("story");
});

test("an inline comment at the end of a row keeps the row", () => {
  const text = "## Story list\n\n| Story | What | Lane | Status |\n| --- | --- | --- | --- |\n| A-1 Thing | x | normal | planned | <!-- note -->\n";
  expect(parseEpic("/x/E1-y/EPIC.md", text).rows.map((r) => [r.id, r.status])).toEqual([["A-1", "planned"]]);
});

test("a row after closed comments in an earlier section is read; an unclosed comment hides the rest", () => {
  const table = "## Story list\n\n| Story | What | Lane | Status |\n| --- | --- | --- | --- |\n| A-1 Thing | x | normal | planned |\n";
  const closed = "## Goal\n\nWrite notes as `<!-- x -->`.\n\n<!--\nmore\n-->\n\n";
  expect(parseEpic("/x/E1-y/EPIC.md", closed + table).rows.map((r) => r.id)).toEqual(["A-1"]);
  // Markdown hides everything after an unclosed `<!--`.
  expect(parseEpic("/x/E1-y/EPIC.md", "## Goal\n\n<!-- open\n\n" + table).rows).toEqual([]);
});

test("a commented Ledger example outside the Ledger section is not an entry", () => {
  const text = [
    "# E1 — X",
    "",
    "<!--",
    "  ## Ledger",
    "  ### S-1 — YYYY-MM-DD",
    "-->",
    "",
    "## Story list",
    "",
    "## Ledger",
    "",
    "### S-1 — 2026-10-20 <!-- closed late -->",
    "",
    "- Shipped: one.",
  ].join("\n");
  expect(ledgerEntry(text, "S-1")).toBe("### S-1 — 2026-10-20 \n\n- Shipped: one.".replace(" \n", "\n"));
});

test("storyOfName picks the longest id, so S and S-1 never collide", () => {
  const ids = ["S", "S-1", "S-10"];
  expect(storyOfName(ids, "feat/", "feat/S-1-next")).toBe("S-1");
  expect(storyOfName(ids, "feat/", "feat/S-base")).toBe("S");
  expect(storyOfName(ids, "feat/", "feat/S-10-x")).toBe("S-10");
  expect(storyOfName(ids, "", "S-1-packet")).toBe("S-1");
  expect(storyOfName(ids, "feat/", "fix/S-1-x")).toBeUndefined();
});

test("findEpicDir refuses a ref that would leave the epics folder", async () => {
  await initE99(root);
  for (const ref of ["../E99-test-epic", "a/b", "a\\b", ".."]) {
    expect(() => findEpicDir(root, loadConfig(root), ref), ref).toThrow("cannot hold `/`, `\\` or `..`");
  }
});
