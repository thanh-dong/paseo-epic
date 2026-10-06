import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Zod mirrors of the core result types (server/core). Shared code cannot
// import server/, so the field names are repeated here; `npm run typecheck`
// fails when a handler's core result no longer fits its contract.

const workspaceDir = z.string().min(1);

const rowSchema = z.object({
  id: z.string(),
  title: z.string(),
  lane: z.string(),
  status: z.string(),
  done: z.string(),
  lineNo: z.number(),
});

const statusResultSchema = z.object({
  epic: z.string(),
  title: z.string(),
  epicBranch: z.string(),
  state: z.string(),
  stories: z.string(),
  next: z.string(),
  behind: z.string().nullable(),
  rows: z.array(rowSchema),
  openPr: z.object({ number: z.number(), url: z.string(), headRefName: z.string() }).nullable(),
  problems: z.array(z.string()),
});

const checkResultSchema = z.object({
  dir: z.string(),
  problems: z.array(z.string()),
  summary: z.string(),
});

const startResultSchema = z.object({
  epic: z.string(),
  epicBranch: z.string(),
  behind: z.string(),
  story: z.string(),
  title: z.string(),
  lane: z.string(),
  storyBranch: z.string(),
  action: z.enum(["created", "resumed", "dry-run"]),
  handoff: z.string(),
  warnings: z.array(z.string()),
});

const closeResultSchema = z.object({
  committed: z.boolean(),
  message: z.string(),
  pushed: z.boolean(),
  pr: z.object({ number: z.number(), url: z.string() }).nullable(),
  epicPr: z.object({ url: z.string() }).nullable(),
  manual: z.array(z.string()),
});

const mergedPrSchema = z.object({
  number: z.number(),
  url: z.string(),
  headRefName: z.string(),
  mergedAt: z.string(),
  title: z.string(),
});

const prCommentSchema = z.object({
  author: z.string(),
  association: z.string(),
  createdAt: z.string(),
  body: z.string(),
});

const nextSpawnResultSchema = z.object({
  epic: z.string(),
  epicBranch: z.string(),
  closed: z.object({
    story: z.string(),
    pr: mergedPrSchema.nullable(),
    comments: z.array(prCommentSchema),
  }),
  next: z
    .object({
      story: z.string(),
      title: z.string(),
      lane: z.string(),
      branch: z.string(),
      baseRef: z.string(),
    })
    .nullable(),
  spawned: z.object({ workspaceId: z.string(), agentId: z.string(), title: z.string() }).nullable(),
  message: z.string(),
});

const storyChangesResultSchema = z.object({
  story: z.string(),
  title: z.string(),
  status: z.string(),
  done: z.string(),
  workspace: z.object({ id: z.string(), directory: z.string(), name: z.string() }).nullable(),
  agent: z.object({ id: z.string(), title: z.string().nullable(), status: z.string() }).nullable(),
  pr: z.object({ number: z.number(), url: z.string(), state: z.enum(["open", "merged"]) }).nullable(),
  changes: z
    .object({
      base: z.string(),
      head: z.string(),
      ahead: z.number(),
      files: z.array(
        z.object({ path: z.string(), status: z.enum(["A", "M", "D", "R"]), committed: z.boolean() }),
      ),
    })
    .nullable(),
  note: z.string().nullable(),
});

export const statusRpc = defineRpc({
  name: "epic.status",
  input: z.object({ workspaceDir, ref: z.string().optional() }),
  output: statusResultSchema,
});

export const checkRpc = defineRpc({
  name: "epic.check",
  input: z.object({ workspaceDir, ref: z.string().optional() }),
  output: z.array(checkResultSchema),
});

export const initRpc = defineRpc({
  name: "epic.init",
  input: z.object({ workspaceDir, epicId: z.string(), title: z.string() }),
  output: z.object({ dir: z.string(), branch: z.string() }),
});

export const startRpc = defineRpc({
  name: "epic.start",
  input: z.object({ workspaceDir, ref: z.string() }),
  output: startResultSchema,
});

export const closeRpc = defineRpc({
  name: "epic.close",
  input: z.object({ workspaceDir, story: z.string() }),
  output: closeResultSchema,
});

export const nextRpc = defineRpc({
  name: "epic.next",
  input: z.object({ workspaceDir, story: z.string().optional(), ref: z.string().optional() }),
  output: nextSpawnResultSchema,
});

export const isEpicRpc = defineRpc({
  name: "epic.is-epic",
  input: z.object({ workspaceDir }),
  output: z.object({ epic: z.boolean() }),
});

export const storyChangesRpc = defineRpc({
  name: "epic.story-changes",
  input: z.object({ workspaceDir, story: z.string() }),
  output: storyChangesResultSchema,
});
