import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cmdInit, cmdStart } from "../server/core/commands";
import { type EpicConfig, loadConfig } from "../server/core/config";
import { currentBranch } from "../server/core/git";
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
