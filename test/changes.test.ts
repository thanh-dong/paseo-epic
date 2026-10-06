import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { parseNameStatus, parsePorcelain, storyChanges } from "../server/core/changes";
import { cmdStart } from "../server/core/commands";
import { loadConfig } from "../server/core/config";
import { git, RemoteFixture } from "./fixtures";

const EPIC = "epic/E99-test-epic";
const STORY = "feat/TH-901-first-thing";

let fx: RemoteFixture;

beforeEach(async () => {
  fx = new RemoteFixture();
  await fx.setup();
  await fx.planAndPush();
  await cmdStart(fx.root, loadConfig(fx.root), "TH-901", { noGh: true });
});

afterEach(() => {
  fx.teardown();
});

test("a just-cut story has no changes", async () => {
  const out = await storyChanges(fx.root, EPIC);
  expect(out).toEqual({ base: `origin/${EPIC}`, head: STORY, ahead: 0, files: [] });
});

test("committed, uncommitted, untracked, deleted and renamed files", async () => {
  mkdirSync(join(fx.root, "src"));
  writeFileSync(join(fx.root, "src", "one.ts"), "export const one = 1;\n");
  writeFileSync(join(fx.root, "docs", "templates", "epic.md"), "changed\n");
  rmSync(join(fx.root, "docs", "templates", "handoff.md"));
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "one");
  await git(fx.root, "mv", "src/one.ts", "src/uno.ts");
  await git(fx.root, "commit", "-q", "-m", "rename");
  writeFileSync(join(fx.root, "src", "uno.ts"), "export const uno = 1;\n");
  mkdirSync(join(fx.root, "notes"));
  writeFileSync(join(fx.root, "notes", "with space.md"), "note\n");

  const out = await storyChanges(fx.root, EPIC);
  expect(out.ahead).toBe(2);
  // src/one.ts never existed on the epic base, so against the base the committed
  // diff is `A src/uno.ts`; the ruling keeps `A` when the uncommitted status is `M`.
  expect(out.files).toEqual([
    { path: "docs/templates/epic.md", status: "M", committed: true },
    { path: "docs/templates/handoff.md", status: "D", committed: true },
    { path: "notes/with space.md", status: "A", committed: false },
    { path: "src/uno.ts", status: "A", committed: false },
  ]);
});

test("a merge of main into the epic does not pollute the story's list", async () => {
  const other = join(fx.tmp, "other");
  await git(fx.tmp, "clone", "-q", fx.remote, other);
  await git(other, "config", "user.email", "t@example.com");
  await git(other, "config", "user.name", "Test");
  writeFileSync(join(other, "main-only.txt"), "main\n");
  await git(other, "add", "-A");
  await git(other, "commit", "-q", "-m", "main only");
  await git(other, "push", "-q", "origin", "main");

  await git(fx.root, "fetch", "-q");
  await git(fx.root, "checkout", "-q", EPIC);
  await git(fx.root, "merge", "-q", "--no-edit", "origin/main");
  await git(fx.root, "push", "-q");
  await git(fx.root, "checkout", "-q", STORY);

  const out = await storyChanges(fx.root, EPIC);
  expect(out.ahead).toBe(0);
  expect(out.files).toEqual([]);
});

test("a base file renamed in a commit and edited again stays renamed", async () => {
  await git(fx.root, "mv", "docs/templates/epic.md", "docs/templates/epic-renamed.md");
  await git(fx.root, "commit", "-q", "-m", "rename epic template");
  writeFileSync(join(fx.root, "docs", "templates", "epic-renamed.md"), "edited after the rename\n", { flag: "a" });

  const out = await storyChanges(fx.root, EPIC);
  expect(out.ahead).toBe(1);
  expect(out.files).toEqual([{ path: "docs/templates/epic-renamed.md", status: "R", committed: false }]);
});

test("an uncommitted rename of a base file drops the old path", async () => {
  writeFileSync(join(fx.root, "docs", "templates", "epic.md"), "edited\n", { flag: "a" });
  await git(fx.root, "commit", "-q", "-am", "edit epic template");
  await git(fx.root, "mv", "docs/templates/epic.md", "docs/templates/e2.md");

  const out = await storyChanges(fx.root, EPIC);
  expect(out.ahead).toBe(1);
  expect(out.files).toEqual([{ path: "docs/templates/e2.md", status: "R", committed: false }]);
});

test("an uncommitted rename of a file new on the story stays new", async () => {
  mkdirSync(join(fx.root, "src"));
  writeFileSync(join(fx.root, "src", "new.ts"), "export const fresh = 1;\n");
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "new file");
  await git(fx.root, "mv", "src/new.ts", "src/newer.ts");

  const out = await storyChanges(fx.root, EPIC);
  expect(out.ahead).toBe(1);
  expect(out.files).toEqual([{ path: "src/newer.ts", status: "A", committed: false }]);
});

test("refuses when the epic branch is not on the remote", async () => {
  await expect(storyChanges(fx.root, "epic/E1-missing")).rejects.toThrow(
    "origin/epic/E1-missing does not exist; push the epic branch first",
  );
});

test("refuses when the story worktree no longer exists", async () => {
  const gone = join(fx.root, "no-such-worktree");
  await expect(storyChanges(gone, EPIC)).rejects.toThrow(
    `the story worktree ${gone} no longer exists; archive its workspace in Paseo or start the story again`,
  );
});

test("parsePorcelain and parseNameStatus handle renames and quoted paths", () => {
  expect(parseNameStatus("M\ta.ts\nR100\told.ts\tnew.ts\nA\tb.ts\n")).toEqual([
    { path: "a.ts", status: "M", committed: true },
    { path: "new.ts", status: "R", committed: true },
    { path: "b.ts", status: "A", committed: true },
  ]);
  expect(parsePorcelain('?? "with space.md"\n D gone.ts\nR  old.ts -> new.ts\n M edit.ts\n')).toEqual([
    { path: "with space.md", status: "A", committed: false },
    { path: "gone.ts", status: "D", committed: false },
    { path: "new.ts", status: "R", committed: false, from: "old.ts" },
    { path: "edit.ts", status: "M", committed: false },
  ]);
  expect(parsePorcelain("A  added.ts\nAM both.ts\nD  staged-gone.ts\nRM a/old.ts -> a/new.ts\n")).toEqual([
    { path: "added.ts", status: "A", committed: false },
    { path: "both.ts", status: "A", committed: false },
    { path: "staged-gone.ts", status: "D", committed: false },
    { path: "a/new.ts", status: "R", committed: false, from: "a/old.ts" },
  ]);
  expect(parseNameStatus('C75\told.ts\tcopy.ts\nT\tx\nM\t"say \\"hi\\".md"\n')).toEqual([
    { path: "copy.ts", status: "A", committed: true },
    { path: "x", status: "M", committed: true },
    { path: 'say "hi".md', status: "M", committed: true },
  ]);
});
