import type { PaseoApi } from "@getpaseo/client";
import { type cmdNext, statusDir } from "../core/commands";
import type { EpicConfig } from "../core/config";
import type { localBranchExists } from "../core/git";
import { findEpicDir, loadLocal } from "../core/locate";
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
 * package `status` shows for `ref` (the default package without one).
 */
export async function lastClosedStory(root: string, config: EpicConfig, ref?: string): Promise<string> {
  const { epic } = loadLocal(ref ? findEpicDir(root, config, ref) : await statusDir(root, config));
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

/** The provider the spawn uses when no profile names one. */
const DEFAULT_PROVIDER = "claude";

/**
 * The provider's default model from the daemon (`providers.listModels`), else
 * its first model. The agent config wants `provider/model`; a bare provider is
 * refused, so a spawn with no model to name cannot start.
 */
async function defaultModelFor(paseo: PaseoApi, provider: string): Promise<string> {
  let models: Array<{ id: string; isDefault?: boolean }>;
  try {
    models = (await paseo.providers.listModels(provider as Parameters<PaseoApi["providers"]["listModels"]>[0])).models ?? [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new EpicError(`no model for provider ${provider} (${reason}); create a Paseo profile with a model, or name one in .epic.yml`);
  }
  const model = models.find((m) => m.isDefault) ?? models[0];
  if (!model) throw new EpicError(`provider ${provider} lists no model; create a Paseo profile with a model`);
  return model.id;
}

/**
 * The profile materialized into an agent config. With no profile, `claude` on
 * its default model; a profile with no model gets its provider's default too.
 */
async function agentConfig(paseo: PaseoApi, profile: AgentProfile | undefined) {
  const provider = profile?.provider ?? DEFAULT_PROVIDER;
  const model = profile?.model ?? (await defaultModelFor(paseo, provider));
  const config: {
    provider: string;
    modeId?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  } = { provider: `${provider}/${model}` };
  if (!profile) return config;
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
  return async ({ root, story, ref }) => {
    const cfg = deps.config(root);
    const result = await deps.next(root, cfg, story ?? (await lastClosedStory(root, cfg, ref)));
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
          "Do not start an agent yourself. Tell the user the story continues in that workspace, " +
          `and that they can start an agent there with \`/epic start ${next.story}\` if none is running. ` +
          "This session is finished.",
      };
    }

    // A local branch with no workspace on it (an earlier spawn that failed after the
    // branch was cut, or a branch made by hand): check it out instead of branching off,
    // since branch-off refuses a branch that exists.
    const reuse = await deps.localBranchExists(root, next.branch);
    const branchNote = reuse ? `The worktree reused the existing local branch ${next.branch}.` : "";
    const profiles = (await deps.paseo.config.get()).config.agentProfiles ?? [];
    const config = await agentConfig(deps.paseo, pickProfile(profiles, cfg.profile));

    let workspace: Awaited<ReturnType<PaseoApi["workspaces"]["create"]>>;
    try {
      workspace = await deps.paseo.workspaces.create({
        title,
        source: reuse
          ? { kind: "worktree", cwd: root, action: "checkout", refName: next.branch }
          : {
              kind: "worktree",
              cwd: root,
              action: "branch-off",
              baseBranch: next.baseRef,
              branchName: next.branch,
            },
        // A retry of the same spawn (a second `next`, the RPC racing the hook) gets the same workspace.
        idempotencyKey: `epic:${next.branch}`,
      });
    } catch (err) {
      if (!reuse) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`${reason} (the local branch ${next.branch} already existed and was checked out)`, {
        cause: err,
      });
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
