import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { checkPackage } from "../server/core/check";
import {
  closeProblems,
  cmdClose,
  cmdInit,
  cmdNext,
  cmdRender,
  cmdStart,
  cmdStatus,
  pickMergedPr,
  prBody,
} from "../server/core/commands";
import { type EpicConfig, loadConfig } from "../server/core/config";
import { currentBranch, gitDirty, remoteBranchExists, run } from "../server/core/git";
import { loadLocal } from "../server/core/locate";
import { git, RemoteFixture } from "./fixtures";

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

test("startRefusesWhenRemotePackageIsBroken", async () => {
  const d = await fx.planAndPush();
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("## 3. Plan changes", "## Plan changes"));
  await git(fx.root, "commit", "-q", "-am", "break the handoff");
  await git(fx.root, "push", "-q");
  await expect(cmdStart(fx.root, cfg, "E99", { dryRun: true, noGh: true })).rejects.toThrow(
    "does not pass check",
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

test("runReportsWhyACommandCouldNotStart", async () => {
  await expect(run(["definitely-not-a-cmd-xyz"], fx.root)).rejects.toThrow("ENOENT");
});

test("closeChecksThenCommitsTheEpicFolder", async () => {
  const d = await fx.planAndPush();
  await cmdStart(fx.root, cfg, "TH-901", { noGh: true });
  // Story work, committed.
  writeFileSync(join(fx.root, "one.ts"), "export const one = 1\n");
  await git(fx.root, "add", "-A");
  await git(fx.root, "commit", "-q", "-m", "feat(TH-901): one");

  // Close before the package is updated: refused with the reasons.
  await expect(cmdClose(fx.root, cfg, "TH-901", { noPr: true, noGh: true })).rejects.toThrow(
    "TH-901 row is `planned`",
  );

  // Agent updates the package: row, ledger, handoff.
  fx.mark901Done(d);
  // closeProblems renders in memory: the stale Status block passes, and EPIC.md stays as it was.
  const onDisk = readFileSync(join(d, "EPIC.md"), "utf8");
  expect(await closeProblems(fx.root, cfg, "TH-901")).toEqual([]);
  expect(readFileSync(join(d, "EPIC.md"), "utf8")).toBe(onDisk);

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
  const { epic, handoff } = loadLocal(d);
  expect(epic.status.Next).toBe("TH-902");
  expect(checkPackage(epic, handoff)).toEqual([]);
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
  await cmdRender(fx.root, cfg, "E99");
  const { epic } = loadLocal(d);
  const body = prBody(epic, "TH-901", "docs/stories/epics/E99-test-epic", "TH-902");
  expect(body).toContain("Story TH-901 into `epic/E99-test-epic` (epic E99 — Test epic).");
  expect(body).toContain("## Ledger entry\n\n### TH-901 — 2026-09-06");
  expect(body).toContain(
    "`docs/stories/epics/E99-test-epic/HANDOFF.md` is written for **TH-902**. After this PR merges, " +
      'reply `next` to the closing agent, or press "Start next story" in the Epic panel.',
  );
  expect(prBody(epic, "TH-901", "x", "none")).toContain("## Epic\n\nThis was the last story; E99 is closed.");
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

test("nextRefusesUntilTheCloseIsOnTheEpicTip", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  // Closed locally, PR not merged: origin/epic still has no ledger entry.
  await expect(cmdNext(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "not merged into origin/epic/E99-test-epic",
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
  // TH-902 also closes and lands, so TH-901 is no longer the last ledger entry.
  const f = join(d, "EPIC.md");
  writeFileSync(
    f,
    readFileSync(f, "utf8")
      .replace(
        "| TH-902 Second thing | Builds the second thing. | normal | planned | |",
        "| TH-902 Second thing | Builds the second thing. | normal | implemented | 2026-09-07 PR #2 |",
      )
      .replace("## Dependencies", "### TH-902 — 2026-09-07\n\n- Shipped: two.\n\n## Dependencies"),
  );
  await cmdRender(fx.root, cfg, "E99");
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("after=TH-901 next=TH-902", "after=TH-902 next=TH-903"));
  await git(fx.root, "commit", "-q", "-am", "close TH-902");
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  await expect(cmdNext(fx.root, cfg, "TH-901", { noGh: true })).rejects.toThrow(
    "TH-901 closed earlier; the last story closed on origin/epic/E99-test-epic is TH-902, so run `next TH-902`",
  );
});

test("nextReportsAClosedEpic", async () => {
  const d = await fx.planAndPush();
  await fx.close901(d);
  const f = join(d, "EPIC.md");
  writeFileSync(
    f,
    readFileSync(f, "utf8")
      .replace(
        "| TH-902 Second thing | Builds the second thing. | normal | planned | |",
        "| TH-902 Second thing | Builds the second thing. | normal | dropped | |",
      )
      .replace(
        "| TH-903 Third thing | Builds the third thing. | high-risk | planned | |",
        "| TH-903 Third thing | Builds the third thing. | high-risk | dropped | |",
      ),
  );
  await cmdRender(fx.root, cfg, "E99");
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-902", "next=none"));
  const { epic, handoff } = loadLocal(d);
  expect(checkPackage(epic, handoff)).toEqual([]);
  await git(fx.root, "commit", "-q", "-am", "drop the rest");
  await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
  const out = await cmdNext(fx.root, cfg, "TH-901", { noGh: true });
  expect(out.next).toBeNull();
});

test("next picks the merged PR by head prefix among others", () => {
  const prs = [{ headRefName: "feat/TH-900-old", number: 1 }, { headRefName: "feat/TH-901-first-thing", number: 7 }];
  expect(pickMergedPr(prs, "TH-901")?.number).toBe(7);
  expect(pickMergedPr(prs, "TH-902")).toBeNull();
});

test("statusReportsRowsAndNext", async () => {
  await fx.planAndPush();
  const s = await cmdStatus(fx.root, cfg, "E99");
  expect(s.next).toBe("TH-901");
  expect(s.rows.length).toBe(3);
  expect(s.problems).toEqual([]);
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

/** Init `id` without git on the current branch with one story row; `closed` drops it so the State renders closed. */
async function initPackage(id: string, closed: boolean): Promise<void> {
  const { dir } = await cmdInit(fx.root, cfg, id, `Epic ${id}`, { noGit: true });
  const f = join(dir, "EPIC.md");
  writeFileSync(
    f,
    readFileSync(f, "utf8").replace(
      "| TH-NNN Story title | What it builds, in one or two sentences. | normal | planned | |",
      `| TH-9${id.slice(1)} Only thing | Builds it. | normal | ${closed ? "dropped" : "planned"} | |`,
    ),
  );
  await cmdRender(fx.root, cfg, id);
  expect(loadLocal(dir).epic.status.State).toBe(closed ? "closed" : "planned");
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
  const f = join(d, "EPIC.md");
  writeFileSync(
    f,
    readFileSync(f, "utf8")
      .replace("| normal | planned | |", "| normal | dropped | |")
      .replace("| high-risk | planned | |", "| high-risk | dropped | |"),
  );
  const h = join(d, "HANDOFF.md");
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-902", "next=none"));
  const r = await cmdClose(fx.root, { ...cfg, baseBranch: "develop" }, "TH-901", { noGh: true });
  expect(r.pushed).toBe(true);
  expect(r.manual).toHaveLength(2);
  expect(r.manual[1]).toContain("gh pr create --draft --base develop --head epic/E99-test-epic");
});
