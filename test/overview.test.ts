import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cmdInit } from "../server/core/commands";
import { type EpicConfig, loadConfig } from "../server/core/config";
import { matchWorkspace, overview } from "../server/core/overview";
import { git, RemoteFixture, TEMPLATE_ROW } from "./fixtures";

let fx: RemoteFixture;
let cfg: EpicConfig;

beforeEach(async () => {
  fx = new RemoteFixture();
  await fx.setup();
  cfg = loadConfig(fx.root);
});

afterEach(() => {
  fx.teardown();
});

/** Init an epic from origin/main, let `edit` change its package, then commit and push its branch. */
async function pushEpic(id: string, title: string, edit: (dir: string) => Promise<void> | void): Promise<string> {
  const { dir, branch } = await cmdInit(fx.root, cfg, id, title, { fromRef: "origin/main" });
  await edit(dir);
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", `plan ${id}`);
  await git(fx.root, "push", "-q", "-u", "origin", branch);
  return branch;
}

/**
 * Three epics on origin: E99 open (a commented row in its story list), E98
 * closed (`next=none`), E97 without HANDOFF.md; and an epic branch with no
 * package. The clone ends on main.
 */
async function threeEpics(): Promise<void> {
  const d99 = await fx.planAndPush();
  const f99 = join(d99, "EPIC.md");
  const commented = "<!-- | TH-999 Example | Not a row. | normal | planned | | -->";
  writeFileSync(f99, readFileSync(f99, "utf8").replace("| TH-903", `${commented}\n| TH-903`));
  await git(fx.root, "commit", "-q", "-am", "commented row");
  await git(fx.root, "push", "-q");
  await pushEpic("E98", "Closed one", (d) => {
    const f = join(d, "EPIC.md");
    const row = "| TH-981 Closed thing | Done. | normal | implemented | 2026-10-01 PR #9 |";
    writeFileSync(f, readFileSync(f, "utf8").replace(TEMPLATE_ROW, row).replace("State: planned", "State: closed"));
    const h = join(d, "HANDOFF.md");
    writeFileSync(h, readFileSync(h, "utf8").replace("after=none next=none", "after=TH-981 next=none"));
  });
  await pushEpic("E97", "No handoff", (d) => rmSync(join(d, "HANDOFF.md")));
  await git(fx.root, "checkout", "-q", "-b", "epic/junk", "origin/main");
  await git(fx.root, "push", "-q", "-u", "origin", "epic/junk");
  await git(fx.root, "checkout", "-q", "main");
}

test("overview lists every epic branch on origin, with the handoff, rows and a workspace", async () => {
  await threeEpics();
  const wt = mkdtempSync(join(tmpdir(), "paseo-epic-wt-"));
  try {
    const on99 = join(wt, "e99");
    const on981 = join(wt, "s981");
    await git(fx.root, "worktree", "add", "-q", on99, "epic/E99-test-epic");
    await git(fx.root, "worktree", "add", "-q", "-b", "feat/TH-981-closed-thing", on981, "origin/epic/E98-closed-one");
    const workspaces = [
      { id: "ws-root", directory: fx.root },
      { id: "ws-99", directory: on99 },
      { id: "ws-981", directory: on981 },
      { id: "ws-gone", directory: join(wt, "gone") },
    ];
    const r = await overview(fx.root, cfg, workspaces);
    expect(r.project).toBe(fx.root);
    expect(r.epics).toEqual([
      {
        epic: "E97",
        title: "No handoff",
        branch: "epic/E97-no-handoff",
        state: "planned",
        next: "",
        after: "",
        rows: { total: 1, open: 1 },
        openPr: null,
        workspaceId: "ws-root",
      },
      {
        epic: "E98",
        title: "Closed one",
        branch: "epic/E98-closed-one",
        state: "closed",
        next: "none",
        after: "TH-981",
        rows: { total: 1, open: 0 },
        openPr: null,
        workspaceId: "ws-981",
      },
      {
        epic: "E99",
        title: "Test epic",
        branch: "epic/E99-test-epic",
        state: "planned",
        next: "TH-901",
        after: "none",
        rows: { total: 3, open: 3 },
        openPr: null,
        workspaceId: "ws-99",
      },
    ]);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("overview reads the refs as last fetched; fetch: true picks up a new epic branch", async () => {
  await fx.planAndPush();
  // Another clone pushes a second epic.
  const other = join(fx.tmp, "other");
  await git(fx.tmp, "clone", "-q", fx.remote, other);
  await git(other, "config", "user.email", "t@example.com");
  await git(other, "config", "user.name", "Test");
  await cmdInit(other, loadConfig(other), "E98", "From elsewhere", { fromRef: "origin/main" });
  await git(other, "add", "-A");
  await git(other, "commit", "-q", "-m", "plan E98");
  await git(other, "push", "-q", "-u", "origin", "epic/E98-from-elsewhere");

  const before = await overview(fx.root, cfg, []);
  expect(before.epics.map((e) => e.epic)).toEqual(["E99"]);
  const after = await overview(fx.root, cfg, [], { fetch: true });
  expect(after.epics.map((e) => [e.epic, e.workspaceId])).toEqual([
    ["E98", null],
    ["E99", null],
  ]);
});

test("matchWorkspace: the epic branch, then a story branch of it, then the project root, else none", () => {
  const ids = ["TH-1", "TH-1-2"];
  const ws = (id: string, directory: string, branch: string | null) => ({ id, directory, branch });
  const root = ws("root", "/repo", "main");
  const epic = ws("epic", "/wt/e", "epic/E1-x");
  const story = ws("story", "/wt/s", "feat/TH-1-2-y");
  const other = ws("other", "/wt/o", "feat/TH-9-z");
  expect(matchWorkspace("epic/E1-x", ids, "feat/", "/repo", [root, story, epic])).toBe("epic");
  expect(matchWorkspace("epic/E1-x", ids, "feat/", "/repo", [root, other, story])).toBe("story");
  expect(matchWorkspace("epic/E1-x", ids, "feat/", "/repo", [other, root])).toBe("root");
  expect(matchWorkspace("epic/E1-x", ids, "feat/", "/repo", [other, ws("gone", "/wt/g", null)])).toBeNull();
});
