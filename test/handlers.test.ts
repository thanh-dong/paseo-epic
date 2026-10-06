import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { StoryChanges } from "../server/core/changes";
import type { MergedPr } from "../server/core/git";
import { resolveStoryChanges, type StoryChangesDeps } from "../server/rpc/story-changes";
import { fill, makeRoot } from "./fixtures";

type Workspace = Awaited<ReturnType<StoryChangesDeps["listWorkspaces"]>>[number];
type Agent = Awaited<ReturnType<StoryChangesDeps["listAgents"]>>[number];
type OpenPr = { number: number; title: string; headRefName: string; url: string };

const CHANGES: StoryChanges = {
  base: "origin/epic/E99-test-epic",
  head: "feat/TH-902-second-thing",
  ahead: 1,
  files: [{ path: "two.ts", status: "A", committed: true }],
};

const PROJECT = { projectId: "proj_1", projectRootPath: "/wt" };
const WS_OTHER: Workspace = { id: "ws_1", directory: "/wt/other", name: "Other", branch: "main", ...PROJECT };
const WS_902: Workspace = {
  id: "ws_2",
  directory: "/wt/TH-902",
  name: "TH-902 Second thing",
  branch: "feat/TH-902-second-thing",
  ...PROJECT,
};

function agent(over: Partial<Agent> & { id: string }): Agent {
  return {
    title: null,
    status: "idle",
    cwd: "/elsewhere",
    workspaceId: null,
    labels: {},
    createdAt: "2026-10-06T10:00:00Z",
    ...over,
  };
}

/** A fake with no git and no gh: `changes` returns CHANGES and records its arguments. */
function fakeDeps(opts: {
  workspaces?: Workspace[];
  agents?: Agent[];
  gh?: boolean;
  openPrs?: OpenPr[];
  mergedPrs?: MergedPr[];
  openPrsError?: Error;
}) {
  const calls: Array<[string, string]> = [];
  const prCalls: Array<[string, string, string]> = [];
  const deps: StoryChangesDeps = {
    listWorkspaces: async () => opts.workspaces ?? [],
    listAgents: async () => opts.agents ?? [],
    changes: async (dir, branch) => {
      calls.push([dir, branch]);
      return CHANGES;
    },
    gh: {
      available: async () => opts.gh ?? false,
      openPrs: async (root, base) => {
        prCalls.push(["open", root, base]);
        if (opts.openPrsError) throw opts.openPrsError;
        return opts.openPrs ?? [];
      },
      mergedPrs: async (root, base) => {
        prCalls.push(["merged", root, base]);
        return opts.mergedPrs ?? [];
      },
    },
  };
  return { deps, calls, prCalls };
}

let tmp = "";
let root = "";

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "paseo-epic-rpc-"));
  root = makeRoot(tmp);
  await fill(root);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("finds the workspace by branch and the agent by label", async () => {
  const { deps, calls } = fakeDeps({
    workspaces: [WS_OTHER, WS_902],
    agents: [
      agent({ id: "ag_cwd", cwd: "/wt/TH-902", createdAt: "2026-10-06T12:00:00Z" }),
      agent({
        id: "ag_new",
        title: "TH-902 Second thing",
        workspaceId: "ws_1",
        labels: { "epic.story": "TH-902" },
        createdAt: "2026-10-06T11:00:00Z",
      }),
    ],
  });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out).toEqual({
    story: "TH-902",
    title: "Second thing",
    status: "planned",
    done: "",
    workspace: { id: "ws_2", directory: "/wt/TH-902", name: "TH-902 Second thing" },
    agent: { id: "ag_new", title: "TH-902 Second thing", status: "idle" },
    pr: null,
    changes: CHANGES,
    note: null,
  });
  expect(calls).toEqual([["/wt/TH-902", "epic/E99-test-epic"]]);
});

test("falls back to the agent whose cwd is under the workspace", async () => {
  const { deps } = fakeDeps({
    workspaces: [WS_902],
    agents: [
      agent({ id: "ag_closed", status: "closed", cwd: "/wt/TH-902", createdAt: "2026-10-06T12:00:00Z" }),
      agent({ id: "ag_under", cwd: "/wt/TH-902/apps", createdAt: "2026-10-06T10:00:00Z" }),
      agent({ id: "ag_sibling", cwd: "/wt/TH-9020", createdAt: "2026-10-06T11:00:00Z" }),
    ],
  });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.agent).toEqual({ id: "ag_under", title: null, status: "idle" });
});

test("a second project's workspace and labelled agent are ignored", async () => {
  // No workspace sits at root, but proj_1's root path is a parent of it.
  const story: Workspace = { ...WS_902, projectRootPath: tmp };
  const foreign: Workspace = {
    id: "ws_x",
    directory: "/x/TH-902",
    name: "TH-902 other project",
    branch: "feat/TH-902-other",
    projectId: "proj_2",
    projectRootPath: "/x",
  };
  const blank: Workspace = { ...story, id: "ws_blank", directory: "", name: "Blank" };
  const { deps, calls } = fakeDeps({
    workspaces: [foreign, blank, story],
    agents: [
      agent({
        id: "ag_foreign",
        workspaceId: "ws_x",
        cwd: "/x/TH-902",
        labels: { "epic.story": "TH-902" },
        createdAt: "2026-10-06T12:00:00Z",
      }),
      agent({ id: "ag_foreign_cwd", cwd: "/x/TH-902/apps", labels: { "epic.story": "TH-902" } }),
      agent({ id: "ag_here", cwd: "/wt/TH-902/apps", createdAt: "2026-10-06T09:00:00Z" }),
    ],
  });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.workspace).toEqual({ id: "ws_2", directory: "/wt/TH-902", name: "TH-902 Second thing" });
  expect(out.agent).toEqual({ id: "ag_here", title: null, status: "idle" });
  expect(out.note).toBeNull();
  expect(calls).toEqual([["/wt/TH-902", "epic/E99-test-epic"]]);
});

test("a caller in no workspace searches every project", async () => {
  const foreign: Workspace = {
    id: "ws_x",
    directory: "/x/TH-902",
    name: "TH-902 other project",
    branch: "feat/TH-902-other",
    projectId: "proj_2",
    projectRootPath: "/x",
  };
  const { deps, calls } = fakeDeps({
    workspaces: [foreign, WS_902],
    agents: [agent({ id: "ag_x", workspaceId: "ws_x", labels: { "epic.story": "TH-902" } })],
  });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.workspace).toEqual({ id: "ws_x", directory: "/x/TH-902", name: "TH-902 other project" });
  expect(out.agent).toEqual({ id: "ag_x", title: null, status: "idle" });
  expect(out.note).toBe("more than one workspace is on feat/TH-902-other; showing TH-902 other project");
  expect(calls).toEqual([["/x/TH-902", "epic/E99-test-epic"]]);
});

test("no workspace gives null fields and the note", async () => {
  const { deps, calls } = fakeDeps({ workspaces: [WS_OTHER] });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.workspace).toBeNull();
  expect(out.agent).toBeNull();
  expect(out.changes).toBeNull();
  expect(out.note).toBe("no workspace for TH-902 on this daemon");
  expect(calls).toEqual([]);
});

test("a duplicate worktree on the branch picks the first and notes it", async () => {
  const copy: Workspace = { ...WS_902, id: "ws_3", directory: "/wt/TH-902-copy", name: "TH-902 copy" };
  const { deps, calls } = fakeDeps({ workspaces: [WS_OTHER, WS_902, copy] });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.workspace).toEqual({ id: "ws_2", directory: "/wt/TH-902", name: "TH-902 Second thing" });
  expect(out.note).toBe("more than one workspace is on feat/TH-902-second-thing; showing TH-902 Second thing");
  expect(calls).toEqual([["/wt/TH-902", "epic/E99-test-epic"]]);
});

test("the caller's own workspace wins among duplicates on the branch", async () => {
  const own: Workspace = { ...WS_902, id: "ws_3", directory: root, name: "TH-902 here" };
  const { deps, calls } = fakeDeps({ workspaces: [WS_902, own] });
  const out = await resolveStoryChanges(deps, { root, story: "TH-902" });
  expect(out.workspace).toEqual({ id: "ws_3", directory: root, name: "TH-902 here" });
  expect(out.note).toBe("more than one workspace is on feat/TH-902-second-thing; showing TH-902 here");
  expect(calls).toEqual([[root, "epic/E99-test-epic"]]);
});

test("open PR wins, merged PR only for implemented rows, none without gh", async () => {
  const open: OpenPr = {
    number: 7,
    title: "TH-902",
    headRefName: "feat/TH-902-second-thing",
    url: "https://github.com/o/r/pull/7",
  };
  const merged: MergedPr[] = [
    {
      number: 1,
      url: "https://github.com/o/r/pull/1",
      headRefName: "feat/TH-901-first-thing",
      mergedAt: "2026-09-06T00:00:00Z",
      title: "TH-901",
    },
    {
      number: 5,
      url: "https://github.com/o/r/pull/5",
      headRefName: "feat/TH-902-second-thing",
      mergedAt: "2026-09-07T00:00:00Z",
      title: "TH-902",
    },
  ];

  const withOpen = fakeDeps({ gh: true, openPrs: [open], mergedPrs: merged });
  expect((await resolveStoryChanges(withOpen.deps, { root, story: "TH-902" })).pr).toEqual({
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "open",
  });

  expect(withOpen.prCalls).toEqual([["open", root, "epic/E99-test-epic"]]);

  const noOpen = fakeDeps({ gh: true, openPrs: [], mergedPrs: merged });
  expect((await resolveStoryChanges(noOpen.deps, { root, story: "TH-901" })).pr).toEqual({
    number: 1,
    url: "https://github.com/o/r/pull/1",
    state: "merged",
  });
  expect((await resolveStoryChanges(noOpen.deps, { root, story: "TH-902" })).pr).toBeNull();
  expect(noOpen.prCalls).toEqual([
    ["open", root, "epic/E99-test-epic"],
    ["merged", root, "epic/E99-test-epic"],
    ["open", root, "epic/E99-test-epic"],
  ]);

  const noGh = fakeDeps({ gh: false, openPrs: [open], mergedPrs: merged });
  expect((await resolveStoryChanges(noGh.deps, { root, story: "TH-902" })).pr).toBeNull();
});

test("a gh failure that is not a refusal propagates", async () => {
  const { deps } = fakeDeps({ gh: true, openPrsError: new Error("boom") });
  await expect(resolveStoryChanges(deps, { root, story: "TH-902" })).rejects.toThrow("boom");
});

test("an id that is not a story id refuses with the next step", async () => {
  const { deps } = fakeDeps({});
  await expect(resolveStoryChanges(deps, { root, story: "E99" })).rejects.toThrow(
    "`E99` is not a story id like TH-652; check the story id",
  );
});

test("unknown story refuses with the next step", async () => {
  const { deps } = fakeDeps({});
  await expect(resolveStoryChanges(deps, { root, story: "TH-999" })).rejects.toThrow(
    "no epic package lists TH-999 in this checkout; check out the epic branch or a story branch, or open the panel in the story's worktree",
  );
});
