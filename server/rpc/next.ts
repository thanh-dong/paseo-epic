import type { PaseoApi } from "@getpaseo/client";
import { type cmdNext, statusDir } from "../core/commands";
import type { EpicConfig } from "../core/config";
import type { localBranchExists } from "../core/git";
import { loadLocal } from "../core/locate";
import { afterNext, nextPrompt } from "../core/text";
import { EpicError, type SpawnNext } from "../core/types";

export type { SpawnNext, Spawned } from "../core/types";

type AgentProfile = {
  id: string;
  name: string;
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  notes?: string;
};

/**
 * The story `next` runs for when none is given: the last ledger entry of the
 * package `status` shows without a ref.
 */
export async function lastClosedStory(root: string, config: EpicConfig): Promise<string> {
  const { epic } = loadLocal(await statusDir(root, config));
  const last = epic.ledger.at(-1);
  if (!last) throw new EpicError(`${epic.id} has no closed story yet; close one before running next`);
  return last.id;
}

/**
 * The launch profile (spec section 8): the one `.epic.yml` names by id or
 * name, else the first whose notes mention a story or an epic, else none.
 */
function pickProfile(profiles: AgentProfile[], named: string | undefined): AgentProfile | undefined {
  const byName = named ? profiles.find((p) => p.id === named || p.name === named) : undefined;
  return byName ?? profiles.find((p) => /story|epic/i.test(p.notes ?? ""));
}

/** The profile materialized into an agent config; with no profile, plain `claude`. */
function agentConfig(profile: AgentProfile | undefined) {
  if (!profile) return { provider: "claude" };
  const config: {
    provider: string;
    modeId?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  } = { provider: profile.model ? `${profile.provider}/${profile.model}` : profile.provider };
  if (profile.modeId) config.modeId = profile.modeId;
  if (profile.thinkingOptionId) config.thinkingOptionId = profile.thinkingOptionId;
  if (profile.featureValues) config.featureValues = profile.featureValues;
  return config;
}

/**
 * Build the `next` spawn (spec section 8): run core `next`, then create the
 * next story's worktree and agent through the daemon SDK, once.
 */
export function createSpawnNext(deps: {
  paseo: PaseoApi;
  config: (root: string) => EpicConfig;
  next: typeof cmdNext;
  findWorkspaceByBranch: (branch: string) => Promise<{ id: string; directory: string } | null>;
  localBranchExists: typeof localBranchExists;
}): SpawnNext {
  return async ({ root, story }) => {
    const cfg = deps.config(root);
    const result = await deps.next(root, cfg, story ?? (await lastClosedStory(root, cfg)));
    const next = result.next;
    if (next === null) return { ...result, spawned: null, message: afterNext(result, null) };

    const title = `${next.story} ${next.title}`;
    const hit = await deps.findWorkspaceByBranch(next.branch);
    if (hit) {
      return {
        ...result,
        spawned: { workspaceId: hit.id, agentId: "", title },
        message:
          `A workspace for ${title} already exists on branch ${next.branch}` +
          `${hit.directory ? ` at ${hit.directory}` : ""}; no new agent was started. ` +
          `Continue there, and start an agent with \`/epic start ${next.story}\` if none is running. ` +
          "This session is finished.",
      };
    }

    // A local branch with no workspace on it: Paseo's branch-off refuses it, and that refusal stands.
    const branchNote = (await deps.localBranchExists(root, next.branch))
      ? `Note: a local branch ${next.branch} already existed before the workspace was created.`
      : "";
    const profiles = (await deps.paseo.config.get()).config.agentProfiles ?? [];
    const config = agentConfig(pickProfile(profiles, cfg.profile));

    let workspace: Awaited<ReturnType<PaseoApi["workspaces"]["create"]>>;
    try {
      workspace = await deps.paseo.workspaces.create({
        title,
        source: {
          kind: "worktree",
          cwd: root,
          action: "branch-off",
          baseBranch: next.baseRef,
          branchName: next.branch,
        },
      });
    } catch (err) {
      if (!branchNote) throw err;
      throw new Error(`${(err as Error).message} (${branchNote})`, { cause: err });
    }
    const agent = await workspace.agents.create({
      config,
      title,
      prompt: nextPrompt(result, cfg.hooks.nextPrompt),
      labels: { "epic.story": next.story },
    });
    const spawned = { workspaceId: workspace.id, agentId: agent.id, title };
    const message = [afterNext(result, spawned), branchNote].filter((s) => s.length > 0).join(" ");
    return { ...result, spawned, message };
  };
}
