import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cmdClose, cmdInit, cmdNext, cmdStart, cmdStatus, pickMergedPr, prBody } from "../server/core/commands";
import { type EpicConfig, loadConfig } from "../server/core/config";
import { currentBranch, gitDirty, remoteBranchExists, run } from "../server/core/git";
import { loadLocal } from "../server/core/locate";
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

/** Remove the `<!-- handoff: ... -->` header line from a HANDOFF.md. */
function dropHeader(file: string): void {
  writeFileSync(file, readFileSync(file, "utf8").replace(/<!-- handoff:.*-->\n/, ""));
}

test("startReadsHandoffFromRemoteTipAndGuardsStory", async () => {
  const d = await fx.planAndPush();
  // Working copy drifts: the local handoff says TH-902, the pushed one says TH-901.
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-901", "next=TH-902"));
  await git(fx.root, "commit", "-q", "-am", "local drift, not pushed");

  await expect(cmdStart(fx.root, cfg, "TH-902", { dryRun: true, noGh: true })).rejects.toThrow(
    "written for TH-901, not TH-902",
  );

  const r = await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  expect(r.action).toBe("created");
  expect(r.storyBranch).toBe("feat/TH-901-first-thing");
  expect(r.handoff).toContain("next=TH-901");
  expect(r.warnings.some((w) => w.includes("gh not used"))).toBe(true);
  expect(await currentBranch(fx.root)).toBe("feat/TH-901-first-thing");
  // The branch was cut from origin/epic, so the drifted local commit is not on it.
  expect(readFileSync(h, "utf8")).toContain("next=TH-901");
});

test("startChecksNoContent: a handoff without its headings and a next story with no row still start", async () => {
  const d = await fx.planAndPush({ next: "X-1" });
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("## 3. Plan changes", "## Plan changes"));
  await git(fx.root, "commit", "-q", "-am", "drop a heading");
  await git(fx.root, "push", "-q");
  const r = await cmdStart(fx.root, cfg, "E99", { noGh: true });
  // X-1 is no row: no title or lane, and the branch slug is the id.
  expect([r.story, r.title, r.lane, r.storyBranch]).toEqual(["X-1", "", "", "feat/X-1-x-1"]);
});

test("startRefusesAHandoffWithoutItsHeaderOnTheTip", async () => {
  const d = await fx.planAndPush();
  dropHeader(join(d, "HANDOFF.md"));
  await git(fx.root, "commit", "-q", "-am", "drop the header");
  await git(fx.root, "push", "-q");
  await expect(cmdStart(fx.root, cfg, "E99", { dryRun: true, noGh: true })).rejects.toThrow(
    "HANDOFF.md on origin/epic/E99-test-epic has no handoff header",
  );
});

test("startRefusesNextNone", async () => {
  await fx.planAndPush({ next: "none" });
  await expect(cmdStart(fx.root, cfg, "E99", { dryRun: true, noGh: true })).rejects.toThrow(
    "says next=none: E99 has no open story",
  );
});

test("startRefusesADirtyTree", async () => {
  await fx.planAndPush();
  appendFileSync(join(fx.root, "docs", "templates", "epic.md"), "\nlocal edit\n");
  await expect(cmdStart(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "working tree has uncommitted changes",
  );
});

test("startRefusesMissingRemoteBranch", async () => {
  await cmdInit(fx.root, cfg, "E99", "Test epic", { fromRef: "origin/main" });
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "plan, not pushed");
  await expect(cmdStart(fx.root, cfg, "E99", { dryRun: true, noGh: true })).rejects.toThrow(
    "does not exist",
  );
});

test("epicBranchPrefix names the epic branch for init, start and status", async () => {
  writeFileSync(join(fx.root, ".epic.yml"), "epicBranchPrefix: epics/\n");
  cfg = loadConfig(fx.root);
  const d = await fx.planAndPush();
  expect(loadLocal(d).epic.status.Branch).toBe("epics/E99-test-epic");
  const r = await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  expect(r.epicBranch).toBe("epics/E99-test-epic");
  expect(await currentBranch(fx.root)).toBe("feat/TH-901-first-thing");
  expect((await cmdStatus(fx.root, cfg)).epicBranch).toBe("epics/E99-test-epic");
});

test("runReportsStdoutWhenStderrIsEmpty", async () => {
  await expect(
    run([process.execPath, "-e", "process.stdout.write('why'); process.exit(1)"], fx.root),
  ).rejects.toThrow("failed:\nwhy");
});

test("initWritesDollarSignsInTheTitleVerbatim", async () => {
  const { dir } = await cmdInit(fx.root, cfg, "E98", "Cut $$ costs", { noGit: true });
  expect(readFileSync(join(dir, "EPIC.md"), "utf8")).toContain("# E98 — Cut $$ costs");
  expect(readFileSync(join(dir, "HANDOFF.md"), "utf8")).toContain("E98 — Cut $$ costs");
});

test("initRefusesAnEpicIdTheFolderCannotHold", async () => {
  for (const id of ["", "E-1", "a/b", "E 1"]) {
    await expect(cmdInit(fx.root, cfg, id, "X", { noGit: true }), id).rejects.toThrow("cannot be an epic id");
  }
  // Any other shape is fine.
  const { dir } = await cmdInit(fx.root, cfg, "Search2", "X", { noGit: true });
  expect(loadLocal(dir).epic.id).toBe("Search2");
});

test("runReportsWhyACommandCouldNotStart", async () => {
  await expect(run(["definitely-not-a-cmd-xyz"], fx.root)).rejects.toThrow("ENOENT");
});

test("closeCommitsTheEpicFolderAndChecksNoContent", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  // Story work, committed.
  writeFileSync(join(fx.root, "one.ts"), "export const one = 1\n");
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "feat(TH-901): one");

  // Agent updates the package: row, ledger, handoff. The plugin renders nothing.
  fx.mark901Done(d);
  const onDisk = readFileSync(join(d, "EPIC.md"), "utf8");
  const r = await cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true });
  expect(r.committed).toBe(true);
  expect(r.message).toBe("docs(E99): close TH-901; handoff for TH-902");
  expect(r.pushed).toBe(false);
  expect(r.pr).toBeNull();
  expect(r.manual[0]).toBe("git push -u origin feat/TH-901-first-thing");
  expect(r.manual[1]).toContain("gh pr create --base epic/E99-test-epic --head feat/TH-901-first-thing");
  expect(await gitDirty(fx.root)).toBe("");
  const log = await git(fx.root, "log", "-1", "--pretty=%s");
  expect(log.trim()).toBe("docs(E99): close TH-901; handoff for TH-902");
  expect(readFileSync(join(d, "EPIC.md"), "utf8")).toBe(onDisk);
});

test("closeRefusesAHandoffThatDoesNotSayAfterStoryOrStillSaysNextStory", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  const h = join(d, "HANDOFF.md");
  const planned = readFileSync(h, "utf8");
  // Not rewritten yet: after=none next=TH-901.
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "HANDOFF.md says after=none; set after=TH-901 before epic_close",
  );
  writeFileSync(h, planned.replace("after=none next=TH-901", "after=TH-901 next=TH-901"));
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "HANDOFF.md still says next=TH-901; point next= at the following story or none",
  );
  // Nothing was committed by the refusals.
  expect((await git(fx.root, "log", "-1", "--pretty=%s")).trim()).toBe("plan E99");
});

test("closeRefusesALocalHandoffWithoutItsHeader", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  dropHeader(join(d, "HANDOFF.md"));
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "HANDOFF.md in docs/stories/epics/E99-test-epic has no handoff header",
  );
});

test("closeWithoutGhPushesAndListsThePrCommand", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  fx.mark901Done(d);
  const r = await cmdClose(fx.root, cfg, "TH-901", { noGh: true });
  expect(r.pushed).toBe(true);
  expect(await remoteBranchExists(fx.root, "feat/TH-901-first-thing")).toBe(true);
  expect(r.pr).toBeNull();
  expect(r.manual).toHaveLength(1);
  const prefix =
    "gh pr create --base epic/E99-test-epic --head feat/TH-901-first-thing --title 'TH-901: First thing' --body-file ";
  expect(r.manual[0].startsWith(prefix)).toBe(true);
  const body = readFileSync(r.manual[0].slice(prefix.length), "utf8");
  expect(body).toContain("### TH-901 — 2026-09-06");
});

test("prBodyCarriesTheLedgerEntryAndTheHandoffSentence", async () => {
  const d = await fx.planAndPush();
  fx.mark901Done(d);
  const { epic } = loadLocal(d);
  const body = prBody(epic, "TH-901", "docs/stories/epics/E99-test-epic", "TH-902", "epic/E99-test-epic");
  expect(body).toContain("Story TH-901 into `epic/E99-test-epic` (epic E99 — Test epic).");
  expect(body).toContain("## Ledger entry\n\n### TH-901 — 2026-09-06");
  expect(body).toContain(
    "`docs/stories/epics/E99-test-epic/HANDOFF.md` is written for **TH-902**. After this PR merges, " +
      'reply `next` to the closing agent, or press "Start next story" in the Epic panel.',
  );
  expect(prBody(epic, "TH-901", "x", "none", "epic/E99-test-epic")).toContain(
    "## Epic\n\nThis was the last story; E99 is closed.",
  );
  expect(body).not.toContain("Generated with");
  expect(body.endsWith("\n")).toBe(true);
});

test("closeRefusesUncommittedStoryWork", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  writeFileSync(join(fx.root, "one.ts"), "x");
  await git(fx.root, "add", "one.ts");
  fx.mark901Done(d);
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "outside the epic folder",
  );
});

test("closeRefusesWrongBranch", async () => {
  await fx.planAndPush();
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "not the story branch",
  );
});

test("closeRefusesABranchThatOnlyContainsTheStoryId", async () => {
  await fx.planAndPush();
  for (const branch of ["feat/TH-9010-other", "fix/TH-901-first-thing"]) {
    await git(fx.root, "checkout", "-q", "-b", branch);
    await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
      "not the story branch",
    );
  }
});

test("nextRefusesUntilTheCloseIsOnTheEpicTip", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  // Closed locally, PR not merged: the handoff on origin/epic still says after=none.
  await expect(cmdNext(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "TH-901 is not merged into origin/epic/E99-test-epic yet (the handoff there says after=none)",
  );
});

test("nextReportsTheNextStoryAfterTheMerge", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  // The PR merges: the story branch lands on the epic branch at the remote.
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  const out = await cmdNext(fx.root, cfg, "TH-901", { noGh: true });
  expect(out.epic).toBe("E99");
  expect(out.epicBranch).toBe("epic/E99-test-epic");
  expect(out.closed).toEqual({ story: "TH-901", pr: null, comments: [] });
  expect(out.next).toEqual({
    story: "TH-902",
    title: "Second thing",
    lane: "normal",
    branch: "feat/TH-902-second-thing",
    baseRef: "origin/epic/E99-test-epic",
  });
});

test("nextRefusesAStoryClosedEarlier", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  // TH-902 also closes and lands, so the handoff on the tip says after=TH-902.
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("after=TH-901 next=TH-902", "after=TH-902 next=TH-903"));
  await git(fx.root, "commit", "-q", "-am", "close TH-902");
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  await expect(cmdNext(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "TH-901 is not the last closed story on origin/epic/E99-test-epic; the handoff there says after=TH-902, so run next TH-902",
  );
  expect((await cmdNext(fx.root, cfg, "TH-902", { noGh: true })).next?.story).toBe("TH-903");
});

test("nextForALaterStoryThanTheTipsAfterSaysNotMergedYet", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  // The tip says after=TH-901; TH-902 comes later in the table, so it is simply not merged yet.
  await expect(cmdNext(fx.root, cfg, "TH-902", { noGh: true })).rejects.toThrow(
    "TH-902 is not merged into origin/epic/E99-test-epic yet (the handoff there says after=TH-901)",
  );
});

test("nextRefusesAHandoffWithoutItsHeaderOnTheTip", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  dropHeader(join(d, "HANDOFF.md"));
  await git(fx.root, "commit", "-q", "-am", "drop the header");
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  await expect(cmdNext(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "HANDOFF.md on origin/epic/E99-test-epic has no handoff header",
  );
});

test("nextReportsAClosedEpic", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  // The rows stay `planned` in the table: only the handoff's next=none closes the epic.
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-902", "next=none"));
  await git(fx.root, "commit", "-q", "-am", "drop the rest");
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  const out = await cmdNext(fx.root, cfg, "TH-901", { noGh: true });
  expect(out.next).toBeNull();
});

test("next picks the merged PR by head prefix among others", () => {
  const prs = [{ headRefName: "feat/TH-900-old", number: 1 }, { headRefName: "feat/TH-901-first-thing", number: 7 }];
  const ids = ["TH-900", "TH-901", "TH-902"];
  expect(pickMergedPr(prs, "TH-901", "feat/", ids)?.number).toBe(7);
  expect(pickMergedPr(prs, "TH-902", "feat/", ids)).toBeNull();
  // S-1's PR is not S's PR.
  const dash = [{ headRefName: "feat/S-1-next", number: 2 }];
  expect(pickMergedPr(dash, "S", "feat/", ["S", "S-1"])).toBeNull();
  expect(pickMergedPr(dash, "S-1", "feat/", ["S", "S-1"])?.number).toBe(2);
});

test("stories S and S-1 do not collide in the packet slug, the close guard and status", async () => {
  const rows = ["| S Base | One. | normal | planned | |", "| S-1 Next | Two. | normal | planned | |"].join("\n");
  const d = await fx.planAndPush({ rows, next: "S" });
  // A packet folder for S-1 on the tip must not give S its slug.
  mkdirSync(join(d, "S-1-later"));
  writeFileSync(join(d, "S-1-later", "story.md"), "x\n");
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "S-1 packet");
  await git(fx.root, "push", "-q");
  expect((await cmdStart(fx.root, cfg, "S", { noGh: true })).storyBranch).toBe("feat/S-base");
  // On S-1's branch, S cannot close.
  await git(fx.root, "checkout", "-q", "-b", "feat/S-1-later");
  await expect(cmdClose(fx.root, cfg, "S", { noPr: true, noGh: true })).rejects.toThrow("not the story branch for S");
  // Status finds the package from S-1's branch too.
  expect((await cmdStatus(fx.root, cfg)).epic).toBe("E99");
});

test("statusPrefersAnExactEpicBranchOverAStoryBranchMatch", async () => {
  // A story prefix equal to the epic prefix: E1 has a row "E2", and E2's epic branch is checked out.
  const odd = { ...cfg, branchPrefix: "epic/" };
  const one = (await cmdInit(fx.root, odd, "E1", "One", { noGit: true })).dir;
  const f = join(one, "EPIC.md");
  writeFileSync(f, readFileSync(f, "utf8").replace(TEMPLATE_ROW, "| E2 Clash | x | normal | planned | |"));
  await cmdInit(fx.root, odd, "E2", "Two", { noGit: true });
  await git(fx.root, "checkout", "-q", "-b", "epic/E2-two");
  expect((await cmdStatus(fx.root, odd)).epic).toBe("E2");
});

test("statusReportsRowsTheStatusBlockAsWrittenAndTheHandoffNext", async () => {
  await fx.planAndPush();
  const s = await cmdStatus(fx.root, cfg, "E99");
  expect(s.next).toBe("TH-901");
  expect(s.rows.length).toBe(3);
  // The template's Status block as written; the plugin renders nothing from the table.
  expect([s.state, s.stories]).toEqual(["planned", "0 of 0 implemented"]);
  expect(Object.keys(s)).not.toContain("problems");
  expect(s.closeHooks).toEqual([]);
  const hooks = { ...cfg.hooks, close: ["Fill the ledger.", "Run the check."] };
  expect((await cmdStatus(fx.root, { ...cfg, hooks }, "E99")).closeHooks).toEqual(["Fill the ledger.", "Run the check."]);
  expect(s.epic).toBe("E99");
  expect(s.epicBranch).toBe("epic/E99-test-epic");
  expect(s.behind).toBe("0");
  // The remote is not on GitHub, so there is no PR to read.
  expect(s.openPr).toBeNull();
  // Without a ref, the epic comes from the current branch.
  expect((await cmdStatus(fx.root, cfg)).epic).toBe("E99");
});

test("statusWithoutTheEpicBranchOnTheRemote", async () => {
  await expect(cmdStatus(fx.root, cfg)).rejects.toThrow("no epic package under");
  await cmdInit(fx.root, cfg, "E99", "Test epic", { noGit: true });
  const s = await cmdStatus(fx.root, cfg, "E99");
  expect(s.behind).toBeNull();
  expect(s.openPr).toBeNull();
});

/** Init `id` without git on the current branch with one story row; `closed` sets the handoff to after=<row> next=none. */
async function initPackage(id: string, closed: boolean): Promise<void> {
  const { dir } = await cmdInit(fx.root, cfg, id, `Epic ${id}`, { noGit: true });
  const story = `TH-9${id.slice(1)}`;
  const f = join(dir, "EPIC.md");
  writeFileSync(f, readFileSync(f, "utf8").replace(TEMPLATE_ROW, `| ${story} Only thing | Builds it. | normal | planned | |`));
  const h = join(dir, "HANDOFF.md");
  const header = closed ? `after=${story} next=none` : `after=none next=${story}`;
  writeFileSync(h, readFileSync(h, "utf8").replace("after=none next=none", header));
}

test("statusOnMainPicksTheOpenEpicOverAClosedOne", async () => {
  await initPackage("E97", false);
  await initPackage("E98", true);
  expect(await currentBranch(fx.root)).toBe("main");
  expect((await cmdStatus(fx.root, cfg)).epic).toBe("E97");
});

test("statusOnMainPicksTheHigherOfTwoOpenEpics", async () => {
  await initPackage("E9", false);
  await initPackage("E10", false);
  expect((await cmdStatus(fx.root, cfg)).epic).toBe("E10");
});

test("closeOfTheLastStoryListsTheDraftEpicPrIntoTheBaseBranch", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  fx.mark901Done(d);
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-902", "next=none"));
  const r = await cmdClose(fx.root, { ...cfg, baseBranch: "develop" }, "TH-901", { noGh: true });
  expect(r.pushed).toBe(true);
  expect(r.manual).toHaveLength(2);
  expect(r.manual[1]).toContain("gh pr create --draft --base develop --head epic/E99-test-epic");
  // The epic PR body carries no story count.
  expect(r.manual[1]).toContain("'Epic E99 closed. See `docs/stories/epics/E99-test-epic/EPIC.md` §Ledger.");
});

test("story ids of any shape run through start, close, next and status", async () => {
  const rows = [
    "| story-7 Seven | Builds seven. | normal | planned | |",
    "| ABC | Builds abc. | high-risk | planned | |",
    "| TH-E10-1 Scoped | Builds scoped. | normal | planned | |",
  ].join("\n");
  const d = await fx.planAndPush({ rows, next: "story-7" });
  const started = await cmdStart(fx.root, cfg, "story-7", { noGh: true });
  expect([started.title, started.lane, started.storyBranch]).toEqual(["Seven", "normal", "feat/story-7-seven"]);
  expect((await cmdStatus(fx.root, cfg)).epic).toBe("E99");

  writeFileSync(join(fx.root, "seven.ts"), "export const seven = 7\n");
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "feat: seven");
  const f = join(d, "EPIC.md");
  const entry = "### story-7 — 2026-10-20\n\n- Shipped: seven.\n\n## Dependencies";
  writeFileSync(f, readFileSync(f, "utf8").replace("## Dependencies", entry));
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("after=none next=story-7", "after=story-7 next=ABC"));
  const closed = await cmdClose(fx.root, cfg, "story-7", { noGh: true });
  const prefix =
    "gh pr create --base epic/E99-test-epic --head feat/story-7-seven --title 'story-7: Seven' --body-file ";
  expect(closed.manual[0].startsWith(prefix)).toBe(true);
  expect(readFileSync(closed.manual[0].slice(prefix.length), "utf8")).toContain(
    "### story-7 — 2026-10-20\n\n- Shipped: seven.",
  );

  await git(fx.root, "push", "-q", "origin", "feat/story-7-seven:epic/E99-test-epic");
  const out = await cmdNext(fx.root, cfg, "story-7", { noGh: true });
  // ABC has no title: the branch slug is the id.
  expect(out.next).toEqual({
    story: "ABC",
    title: "",
    lane: "high-risk",
    branch: "feat/ABC-abc",
    baseRef: "origin/epic/E99-test-epic",
  });
  expect((await cmdStart(fx.root, cfg, "ABC", { noGh: true })).storyBranch).toBe("feat/ABC-abc");
  const s = await cmdStatus(fx.root, cfg);
  expect([s.epic, s.next]).toEqual(["E99", "ABC"]);
});
