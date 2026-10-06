import { type StoryChanges, storyChanges } from "../core/changes";
import { epicBranch, rowOf } from "../core/check";
import { pickMergedPr } from "../core/commands";
import { loadConfig } from "../core/config";
import { ghAvailable, ghMergedPrs, ghOpenPrs } from "../core/git";
import { findEpicDir, loadLocal } from "../core/locate";
import { EpicError, STORY_ID_RE } from "../core/types";
import type { PaseoApi } from "../sdk-types";

interface WorkspaceEntry {
  id: string;
  directory: string;
  name: string;
  branch: string | null;
  projectId: string;
  projectRootPath: string;
}

interface AgentEntry {
  id: string;
  title: string | null;
  status: string;
  cwd: string;
  workspaceId: string | null;
  labels: Record<string, string>;
  createdAt: string;
}

/** What the resolver reads from the daemon, git and gh; tests pass fakes. */
export interface StoryChangesDeps {
  listWorkspaces: () => Promise<WorkspaceEntry[]>;
  listAgents: () => Promise<AgentEntry[]>;
  changes: typeof storyChanges;
  gh: { available: () => Promise<boolean>; openPrs: typeof ghOpenPrs; mergedPrs: typeof ghMergedPrs };
}

export interface StoryChangesResult {
  story: string;
  title: string;
  status: string;
  done: string;
  workspace: { id: string; directory: string; name: string } | null;
  agent: { id: string; title: string | null; status: string } | null;
  pr: { number: number; url: string; state: "open" | "merged" } | null;
  changes: StoryChanges | null;
  note: string | null;
}

/** True when `cwd` is `dir` or a path inside it. */
function isUnder(cwd: string, dir: string): boolean {
  const base = dir.replace(/[\\/]+$/, "");
  return cwd === base || cwd.startsWith(`${base}/`) || cwd.startsWith(`${base}\\`);
}

/** The newest open agent among `agents`, or null. */
function newest(agents: AgentEntry[]): AgentEntry | null {
  const open = agents.filter((a) => a.status !== "closed");
  if (open.length === 0) return null;
  return open.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
}

/** The story's PR into `base`: open first, merged only for an implemented row; null without gh. */
async function findPr(
  deps: StoryChangesDeps,
  root: string,
  base: string,
  story: string,
  prefix: string,
  status: string,
): Promise<StoryChangesResult["pr"]> {
  try {
    if (!(await deps.gh.available())) return null;
    const open = (await deps.gh.openPrs(root, base)).find((pr) => pr.headRefName.startsWith(`${prefix}${story}-`));
    if (open) return { number: open.number, url: open.url, state: "open" };
    if (status !== "implemented") return null;
    const merged = pickMergedPr(await deps.gh.mergedPrs(root, base), story, prefix);
    return merged ? { number: merged.number, url: merged.url, state: "merged" } : null;
  } catch (err) {
    // gh not logged in, or the remote is not on GitHub: no PR to show.
    if (err instanceof EpicError) return null;
    throw err;
  }
}

/**
 * A story's row, workspace, agent, PR and changed files. Only an unknown story
 * and a missing remote epic branch refuse; anything else not found is null.
 */
export async function resolveStoryChanges(
  deps: StoryChangesDeps,
  input: { root: string; story: string },
): Promise<StoryChangesResult> {
  const { root, story } = input;
  const config = loadConfig(root);
  if (!STORY_ID_RE.test(story)) throw new EpicError(`\`${story}\` is not a story id like TH-652; check the story id`);
  const unknown = `no epic package lists ${story}; check the story id`;
  let dir: string;
  try {
    dir = findEpicDir(root, config, story);
  } catch (err) {
    if (err instanceof EpicError && err.message.startsWith("no EPIC.md story list contains")) {
      throw new EpicError(unknown);
    }
    throw err;
  }
  const { epic } = loadLocal(dir);
  const row = rowOf(epic, story);
  if (row === undefined) throw new EpicError(unknown);
  const base = epicBranch(epic);

  // Search the caller's project only; a caller in no workspace searches them all.
  const all = (await deps.listWorkspaces()).filter((w) => w.directory !== "");
  const caller =
    all.find((w) => w.directory === root) ??
    all.find((w) => w.projectRootPath !== "" && isUnder(root, w.projectRootPath));
  const scoped = caller ? all.filter((w) => w.projectId === caller.projectId) : all;
  const ids = new Set(scoped.map((w) => w.id));

  const prefix = `${config.branchPrefix}${story}-`;
  const onBranch = scoped.filter((w) => w.branch?.startsWith(prefix));
  // The caller's own workspace wins when it is on the story branch.
  const ws = onBranch.find((w) => w.directory === root) ?? onBranch[0] ?? null;
  let note: string | null = null;
  if (ws === null) note = `no workspace for ${story} on this daemon`;
  else if (onBranch.length > 1) note = `more than one workspace is on ${ws.branch}; showing ${ws.name}`;

  const agents = (await deps.listAgents()).filter(
    (a) => (a.workspaceId !== null && ids.has(a.workspaceId)) || scoped.some((w) => isUnder(a.cwd, w.directory)),
  );
  const agent =
    newest(agents.filter((a) => a.labels["epic.story"] === story)) ??
    (ws && newest(agents.filter((a) => isUnder(a.cwd, ws.directory))));

  return {
    story,
    title: row.title,
    status: row.status,
    done: row.done,
    workspace: ws && { id: ws.id, directory: ws.directory, name: ws.name },
    agent: agent && { id: agent.id, title: agent.title, status: agent.status },
    pr: await findPr(deps, root, base, story, config.branchPrefix, row.status),
    changes: ws && (await deps.changes(ws.directory, base)),
    note,
  };
}

/** Deps backed by the daemon SDK of one handler call and the real git and gh. */
export function defaultDeps(paseo: PaseoApi): StoryChangesDeps {
  return {
    listWorkspaces: async () => {
      const out: WorkspaceEntry[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
        for (const w of page.entries) {
          out.push({
            id: w.id,
            directory: w.workspaceDirectory ?? "",
            name: w.name,
            branch: w.gitRuntime?.currentBranch ?? null,
            projectId: w.projectId,
            projectRootPath: w.projectRootPath,
          });
        }
        if (!page.pageInfo?.hasMore || !page.pageInfo.nextCursor) return out;
        cursor = page.pageInfo.nextCursor;
      }
    },
    listAgents: async () => {
      const out: AgentEntry[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await paseo.agents.list({
          sort: [{ key: "created_at", direction: "desc" }],
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        for (const { agent: a } of page.entries) {
          out.push({
            id: a.id,
            title: a.title,
            status: a.status,
            cwd: a.cwd,
            workspaceId: a.workspaceId ?? null,
            labels: a.labels ?? {},
            createdAt: a.createdAt,
          });
        }
        if (!page.pageInfo?.hasMore || !page.pageInfo.nextCursor) return out;
        cursor = page.pageInfo.nextCursor;
      }
    },
    changes: storyChanges,
    gh: { available: ghAvailable, openPrs: ghOpenPrs, mergedPrs: ghMergedPrs },
  };
}
