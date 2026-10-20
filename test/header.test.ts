import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { headerInfo } from "../server/core/commands";
import { loadConfig } from "../server/core/config";
import { fill, git, makeRoot, RemoteFixture } from "./fixtures";

let fx: RemoteFixture;
let tmp = "";

beforeEach(async () => {
  fx = new RemoteFixture();
  await fx.setup();
  tmp = mkdtempSync(join(tmpdir(), "paseo-epic-header-"));
});

afterEach(() => {
  fx.teardown();
  rmSync(tmp, { recursive: true, force: true });
});

test("headerInfo reads next= from origin when the epic branch is there, not the working copy", async () => {
  const d = await fx.planAndPush();
  const h = join(d, "HANDOFF.md");
  // origin moves on to TH-902; the local checkout stays one commit behind it.
  writeFileSync(h, readFileSync(h, "utf8").replace("next=TH-901", "next=TH-902"));
  await git(fx.root, "commit", "-q", "-am", "handoff for TH-902");
  await git(fx.root, "push", "-q");
  await git(fx.root, "reset", "-q", "--hard", "HEAD~1");
  expect(readFileSync(h, "utf8")).toContain("next=TH-901");
  expect(await headerInfo(fx.root, loadConfig(fx.root))).toEqual({ epic: "E99", next: "TH-902" });
});

test("headerInfo reads the local next= when origin has no epic branch", async () => {
  const root = makeRoot(tmp);
  await fill(root, { next: "TH-903" });
  expect(await headerInfo(root, loadConfig(root))).toEqual({ epic: "E99", next: "TH-903" });
});

test("headerInfo: .epic.yml without a package has no epic; a plain repo is no epic repo", async () => {
  const root = makeRoot(tmp);
  expect(await headerInfo(root, loadConfig(root))).toBeNull();
  writeFileSync(join(root, ".epic.yml"), "baseBranch: main\n");
  expect(await headerInfo(root, loadConfig(root))).toEqual({ epic: null, next: "" });
});
