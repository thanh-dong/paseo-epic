import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { expect, test } from "vitest";
import type { NextResult } from "../server/core/commands";
import type { EpicConfig } from "../server/core/config";
import type { SpawnNext } from "../server/core/types";
import { pendingNextFromTimeline, registerSpawnOnNext } from "../server/hooks/spawn-on-next";
import { findWorkspaceByBranch } from "../server/rpc/handlers";
import { createSpawnNext } from "../server/rpc/next";

const nextResult: NextResult = {
  epic: "E99",
  epicBranch: "epic/E99-test-epic",
  closed: {
    story: "TH-901",
    pr: {
      number: 7,
      url: "https://github.com/o/r/pull/7",
      headRefName: "feat/TH-901-first-thing",
      mergedAt: "2026-10-01T09:00:00Z",
      title: "TH-901: First thing",
    },
    comments: [{ author: "lead", createdAt: "2026-10-01T08:30:00Z", body: "Q1: keep the old flag." }],
  },
  next: {
    story: "TH-902",
    title: "Second thing",
    lane: "normal",
    branch: "feat/TH-902-second-thing",
    baseRef: "origin/epic/E99-test-epic",
  },
};

const baseConfig: EpicConfig = {
  epicsDir: "docs/stories/epics",
  branchPrefix: "feat/",
  baseBranch: "main",
  hooks: { start: [], close: [], nextPrompt: "Use the story profile." },
};

type Profile = {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  notes?: string;
};

/** A fake PaseoApi recording workspace and agent creation. */
function fakePaseo(profiles: Profile[] = []) {
  const calls = { workspaces: [] as unknown[], agents: [] as Array<Record<string, unknown>> };
  const paseo = {
    workspaces: {
      create: async (options: unknown) => {
        calls.workspaces.push(options);
        return {
          id: "ws_1",
          directory: "/wt/TH-902",
          agents: {
            create: async (options: Record<string, unknown>) => {
              calls.agents.push(options);
              return { id: "ag_1" };
            },
          },
        };
      },
    },
    config: { get: async () => ({ requestId: "r", config: { agentProfiles: profiles } }) },
  } as unknown as PaseoApi;
  return { paseo, calls };
}

function spawner(
  paseo: PaseoApi,
  opts: {
    config?: EpicConfig;
    result?: NextResult;
    find?: (branch: string) => Promise<{ id: string; directory: string } | null>;
    localBranch?: boolean;
  } = {},
): SpawnNext {
  return createSpawnNext({
    paseo,
    config: () => opts.config ?? baseConfig,
    next: async () => opts.result ?? nextResult,
    findWorkspaceByBranch: opts.find ?? (async () => null),
    localBranchExists: async () => opts.localBranch ?? false,
  });
}

test("spawns the successor with the handoff prompt and the PR answers", async () => {
  const { paseo, calls } = fakePaseo();
  const out = await spawner(paseo)({ root: "/repo", story: "TH-901" });

  expect(calls.workspaces).toEqual([
    {
      title: "TH-902 Second thing",
      source: {
        kind: "worktree",
        cwd: "/repo",
        action: "branch-off",
        baseBranch: "origin/epic/E99-test-epic",
        branchName: "feat/TH-902-second-thing",
      },
    },
  ]);
  expect(calls.agents).toHaveLength(1);
  const agent = calls.agents[0];
  const prompt = agent.prompt as string;
  expect(prompt).toContain("/epic start TH-902");
  expect(prompt).toContain("Answers from PR #7");
  expect(prompt).toContain("Q1: keep the old flag.");
  expect(prompt).toContain("Use the story profile.");
  expect(agent.labels).toEqual({ "epic.story": "TH-902" });
  expect(agent.title).toBe("TH-902 Second thing");
  expect(agent.config).toEqual({ provider: "claude" });

  expect(out.spawned).toEqual({ workspaceId: "ws_1", agentId: "ag_1", title: "TH-902 Second thing" });
  expect(out.message).toContain('Started agent "TH-902 Second thing"');
  expect(out.next?.story).toBe("TH-902");
});

test("uses the named profile", async () => {
  const { paseo, calls } = fakePaseo([
    { id: "other", name: "Other", provider: "codex", notes: "story work" },
    { id: "story", name: "Story", provider: "claude", model: "opus", modeId: "bypassPermissions" },
  ]);
  await spawner(paseo, { config: { ...baseConfig, profile: "story" } })({ root: "/repo", story: "TH-901" });
  expect(calls.agents[0].config).toEqual({ provider: "claude/opus", modeId: "bypassPermissions" });
});

test("matches the named profile by its name too", async () => {
  const { paseo, calls } = fakePaseo([{ id: "p1", name: "Story", provider: "codex", thinkingOptionId: "high" }]);
  await spawner(paseo, { config: { ...baseConfig, profile: "Story" } })({ root: "/repo", story: "TH-901" });
  expect(calls.agents[0].config).toEqual({ provider: "codex", thinkingOptionId: "high" });
});

test("a named profile that does not exist falls back to the notes", async () => {
  const { paseo, calls } = fakePaseo([{ id: "e", name: "E", provider: "codex", notes: "for epics" }]);
  await spawner(paseo, { config: { ...baseConfig, profile: "missing" } })({ root: "/repo", story: "TH-901" });
  expect(calls.agents[0].config).toEqual({ provider: "codex" });
});

test("without a named profile, picks the first whose notes mention story or epic", async () => {
  const { paseo, calls } = fakePaseo([
    { id: "a", name: "A", provider: "codex", notes: "reviews" },
    { id: "b", name: "B", provider: "claude", model: "sonnet", notes: "Epic story agents", featureValues: { x: 1 } },
  ]);
  await spawner(paseo)({ root: "/repo", story: "TH-901" });
  expect(calls.agents[0].config).toEqual({ provider: "claude/sonnet", featureValues: { x: 1 } });
});

test("does not spawn twice", async () => {
  const { paseo, calls } = fakePaseo();
  let created = false;
  const spawn = spawner(paseo, {
    find: async (branch) => {
      expect(branch).toBe("feat/TH-902-second-thing");
      return created ? { id: "ws_1", directory: "/wt/TH-902" } : null;
    },
  });
  const first = await spawn({ root: "/repo", story: "TH-901" });
  created = true;
  const second = await spawn({ root: "/repo", story: "TH-901" });

  expect(calls.workspaces).toHaveLength(1);
  expect(calls.agents).toHaveLength(1);
  expect(first.spawned?.agentId).toBe("ag_1");
  expect(second.spawned).toEqual({ workspaceId: "ws_1", agentId: "", title: "TH-902 Second thing" });
  expect(second.message).toContain("already exists");
});

test("a local branch without a workspace is noted, and the workspace is still created", async () => {
  const { paseo, calls } = fakePaseo();
  const out = await spawner(paseo, { localBranch: true })({ root: "/repo", story: "TH-901" });
  expect(calls.workspaces).toHaveLength(1);
  expect(out.message).toContain("local branch feat/TH-902-second-thing already existed");
});

test("closed epic spawns nothing", async () => {
  const { paseo, calls } = fakePaseo();
  const out = await spawner(paseo, { result: { ...nextResult, next: null } })({ root: "/repo", story: "TH-901" });
  expect(out.spawned).toBeNull();
  expect(out.message).toContain("closed");
  expect(calls.workspaces).toHaveLength(0);
});

const pendingText =
  '{\n  "epic": "E99"\n}\n\nTH-902 Second thing is next. The plugin is starting the successor now.\n' +
  "Spawn pending for TH-902: the plugin starts the successor now.";

function toolCall(name: string, output: unknown, callId = "c1"): AgentTimelineItem {
  return {
    type: "tool_call",
    callId,
    name,
    status: "completed",
    error: null,
    detail: { type: "unknown", input: { story: "TH-901" }, output },
  } as AgentTimelineItem;
}

test("pendingNextFromTimeline finds the epic_next call", () => {
  const user: AgentTimelineItem = { type: "user_message", text: "next" };
  const output = { content: [{ type: "text", text: pendingText }] };
  expect(pendingNextFromTimeline([user, toolCall("mcp__epic__epic_next", output)])).toEqual({
    story: "TH-902",
    callId: "c1",
  });
  expect(pendingNextFromTimeline([user, toolCall("epic_next", pendingText, "c2")])).toEqual({
    story: "TH-902",
    callId: "c2",
  });
  expect(pendingNextFromTimeline([user, { type: "assistant_message", text: pendingText }])).toBeNull();
  expect(pendingNextFromTimeline([user, toolCall("epic_status", pendingText)])).toBeNull();
  expect(pendingNextFromTimeline([])).toBeNull();
});

test("pendingNextFromTimeline ignores calls before the latest user message", () => {
  const timeline: AgentTimelineItem[] = [
    { type: "user_message", text: "next" },
    toolCall("mcp__epic__epic_next", pendingText),
    { type: "user_message", text: 'Started agent "TH-902 Second thing".' },
    { type: "assistant_message", text: "Done." },
  ];
  expect(pendingNextFromTimeline(timeline)).toBeNull();
});

test("pendingNextFromTimeline tolerates odd items", () => {
  const odd = [
    { type: "tool_call" },
    { type: "tool_call", name: "epic_next" },
    { type: "tool_call", name: "epic_next", detail: null },
  ] as unknown as AgentTimelineItem[];
  expect(pendingNextFromTimeline(odd)).toBeNull();
});

type TurnEnded = (event: unknown, context: { paseo: PaseoApi }) => Promise<void>;

/** A fake server capturing the turn-ended handler, and a paseo recording sends. */
function hookHarness(spawnNext: SpawnNext) {
  let handler: TurnEnded | undefined;
  const server = {
    on: (name: string, fn: TurnEnded) => {
      expect(name).toBe("agent.turn_ended");
      handler = fn;
      return () => {};
    },
  } as unknown as PluginServerContext;
  const sent: Array<{ id: string; text: string }> = [];
  const paseo = {
    agents: { ref: (id: string) => ({ send: async (text: string) => void sent.push({ id, text }) }) },
  } as unknown as PaseoApi;
  const roots: string[] = [];
  registerSpawnOnNext(server, {
    spawnNextFor: () => spawnNext,
    repoRoot: (cwd) => {
      roots.push(cwd);
      return "/repo";
    },
  });
  const fire = (outcome: unknown, timeline: AgentTimelineItem[]) =>
    (handler as TurnEnded)(
      {
        agent: { id: "ag_0", workspaceId: "ws_0", parentAgentId: null, provider: "claude", cwd: "/repo/sub", title: null },
        turnId: "t1",
        outcome,
        timeline,
      },
      { paseo },
    );
  return { sent, roots, fire };
}

const pendingTimeline: AgentTimelineItem[] = [
  { type: "user_message", text: "next" },
  toolCall("mcp__epic__epic_next", pendingText),
];

test("the turn-ended hook spawns once and sends the result to the agent", async () => {
  const seen: Array<{ root: string; story?: string }> = [];
  const { sent, roots, fire } = hookHarness(async (input) => {
    seen.push(input);
    return { ...nextResult, spawned: null, message: "Started agent X." };
  });
  await fire({ kind: "completed" }, pendingTimeline);
  await fire({ kind: "completed" }, pendingTimeline);
  expect(roots).toEqual(["/repo/sub"]);
  expect(seen).toEqual([{ root: "/repo" }]);
  expect(sent).toEqual([{ id: "ag_0", text: "Started agent X." }]);
});

test("the turn-ended hook ignores failed turns and turns without a pending spawn", async () => {
  let calls = 0;
  const { sent, fire } = hookHarness(async () => {
    calls += 1;
    return { ...nextResult, spawned: null, message: "m" };
  });
  await fire({ kind: "failed", error: { message: "x" } }, pendingTimeline);
  await fire({ kind: "completed" }, [{ type: "user_message", text: "hi" }]);
  expect(calls).toBe(0);
  expect(sent).toEqual([]);
});

test("the turn-ended hook sends a spawn failure as text and does not throw", async () => {
  const { sent, fire } = hookHarness(async () => {
    throw new Error("branch exists");
  });
  await expect(fire({ kind: "completed" }, pendingTimeline)).resolves.toBeUndefined();
  expect(sent).toEqual([
    {
      id: "ag_0",
      text: "Spawn failed: branch exists. Start the next story by hand with /epic start TH-902.",
    },
  ]);
});

test("findWorkspaceByBranch pages through workspaces and matches the current branch", async () => {
  const pages = [
    {
      entries: [{ id: "w1", workspaceDirectory: "/a", gitRuntime: { currentBranch: "main" } }, { id: "w2" }],
      pageInfo: { hasMore: true, nextCursor: "c2", prevCursor: null },
    },
    {
      entries: [{ id: "w3", workspaceDirectory: "/wt/b", gitRuntime: { currentBranch: "feat/TH-902-second-thing" } }],
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    },
  ];
  const cursors: Array<string | undefined> = [];
  const paseo = {
    workspaces: {
      list: async (options: { page?: { cursor?: string } }) => {
        cursors.push(options.page?.cursor);
        return pages[cursors.length - 1];
      },
    },
  } as unknown as PaseoApi;
  expect(await findWorkspaceByBranch(paseo, "feat/TH-902-second-thing")).toEqual({ id: "w3", directory: "/wt/b" });
  expect(cursors).toEqual([undefined, "c2"]);
  cursors.length = 0;
  expect(await findWorkspaceByBranch(paseo, "feat/none")).toBeNull();
});
