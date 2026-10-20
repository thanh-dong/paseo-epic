import { join } from "node:path";
import type { EpicConfig } from "./config";
import { ghAvailable, ghOpenPrs, run, runRaw } from "./git";
import { epicsDir, loadFromRef } from "./locate";
import { splitLines, storyOfName } from "./parse";
import { EpicError } from "./types";

export interface OverviewEpic {
  epic: string;
  title: string;
  branch: string;
  /** The Status block's `State:` line as written; display only. */
  state: string;
  /** `next=` / `after=` of the handoff on origin; "" without HANDOFF.md or its header. */
  next: string;
  after: string;
  /** Story rows, and those whose status is `planned` or `in_progress`; display only. */
  rows: { total: number; open: number };
  openPr: { number: number; url: string; headRefName: string } | null;
  workspaceId: string | null;
}

export interface OverviewResult {
  project: string;
  epics: OverviewEpic[];
}

/**
 * The workspace for an epic: one on the epic branch, else one on a story
 * branch of it (`<branchPrefix><id>-…` for one of its row ids), else the one
 * whose directory is the project root, else none.
 */
export function matchWorkspace(
  branch: string,
  storyIds: readonly string[],
  branchPrefix: string,
  projectRoot: string,
  workspaces: ReadonlyArray<{ id: string; directory: string; branch: string | null }>,
): string | null {
  const hit =
    workspaces.find((w) => w.branch === branch) ??
    workspaces.find((w) => w.branch !== null && storyOfName(storyIds, branchPrefix, w.branch) !== undefined) ??
    workspaces.find((w) => w.directory === projectRoot);
  return hit?.id ?? null;
}

/** The epic branch names on origin as last fetched (`<epicBranchPrefix>…`). */
async function originEpicBranches(root: string, config: EpicConfig): Promise<string[]> {
  const out = await run(["git", "for-each-ref", "--format=%(refname:lstrip=3)", "refs/remotes/origin/"], root);
  return splitLines(out).filter((b) => b.startsWith(config.epicBranchPrefix) && b !== config.epicBranchPrefix);
}

/** The branch checked out in `dir`; null when git cannot tell (the directory may be gone). */
async function checkoutBranch(dir: string): Promise<string | null> {
  const r = await runRaw(["git", "rev-parse", "--abbrev-ref", "HEAD"], dir);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** The open PR into `branch`; null without gh or when gh cannot list PRs for this remote. */
async function openPrInto(root: string, branch: string): Promise<OverviewEpic["openPr"]> {
  try {
    const pr = (await ghOpenPrs(root, branch))[0];
    return pr ? { number: pr.number, url: pr.url, headRefName: pr.headRefName } : null;
  } catch (err) {
    if (err instanceof EpicError) return null;
    throw err;
  }
}

/**
 * Every epic of the project as committed on its epic branch on origin, so
 * every worktree sees the same state. It reads the refs as last fetched;
 * `fetch` runs `git fetch origin --prune` first. A branch with no EPIC.md is
 * no epic and is left out. Nothing is checked.
 */
export async function overview(
  root: string,
  config: EpicConfig,
  workspaces: ReadonlyArray<{ id: string; directory: string }>,
  opts: { fetch?: boolean } = {},
): Promise<OverviewResult> {
  if (opts.fetch) await run(["git", "fetch", "origin", "--prune"], root);
  const branches = await originEpicBranches(root, config);
  const located = await Promise.all(workspaces.map(async (w) => ({ ...w, branch: await checkoutBranch(w.directory) })));
  const gh = await ghAvailable();
  const read = async (branch: string): Promise<OverviewEpic | null> => {
    const dir = join(epicsDir(root, config), branch.slice(config.epicBranchPrefix.length));
    let pkg: Awaited<ReturnType<typeof loadFromRef>>;
    try {
      pkg = await loadFromRef(root, dir, `origin/${branch}`);
    } catch (err) {
      if (err instanceof EpicError) return null;
      throw err;
    }
    const { epic, handoff } = pkg;
    const header = handoff?.found ? handoff : null;
    const ids = epic.rows.map((r) => r.id);
    return {
      epic: epic.id,
      title: epic.title,
      branch,
      state: epic.status.State ?? "",
      next: header?.next ?? "",
      after: header?.after ?? "",
      rows: {
        total: epic.rows.length,
        open: epic.rows.filter((r) => r.status === "planned" || r.status === "in_progress").length,
      },
      openPr: gh ? await openPrInto(root, branch) : null,
      workspaceId: matchWorkspace(branch, ids, config.branchPrefix, root, located),
    };
  };
  const epics = await Promise.all(branches.map(read));
  return { project: root, epics: epics.filter((e): e is OverviewEpic => e !== null) };
}
