import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  checkRpc,
  closeRpc,
  initRpc,
  isEpicRpc,
  nextRpc,
  startRpc,
  statusRpc,
} from "../../shared/contracts";
import { cmdCheck, cmdClose, cmdInit, cmdNext, cmdStart, cmdStatus, statusDir } from "../core/commands";
import { type EpicConfig, loadConfig } from "../core/config";
import { isEpicRepo, loadLocal } from "../core/locate";
import { afterNext } from "../core/text";
import { EpicError, type SpawnNext } from "../core/types";

/** Run `fn`; a refusal becomes a plain Error with the same text, so the client shows it inline. */
async function refusalsAsErrors<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EpicError) throw new Error(err.message);
    throw err;
  }
}

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

/** Placeholder until the SDK spawn lands: runs `next` and starts no agent. */
export const spawnNext: SpawnNext = async ({ root, story }) => {
  const config = loadConfig(root);
  const result = await cmdNext(root, config, story ?? (await lastClosedStory(root, config)));
  return { ...result, spawned: null, message: afterNext(result, null) };
};

/** Wire every RPC contract to the core, with `workspaceDir` as the repo root. */
export function registerHandlers(server: PluginServerContext, deps: { spawnNext: SpawnNext }): void {
  server.handle(statusRpc, ({ workspaceDir, ref }) =>
    refusalsAsErrors(() => cmdStatus(workspaceDir, loadConfig(workspaceDir), ref)),
  );
  server.handle(checkRpc, ({ workspaceDir, ref }) =>
    refusalsAsErrors(() => cmdCheck(workspaceDir, loadConfig(workspaceDir), ref)),
  );
  server.handle(initRpc, ({ workspaceDir, epicId, title }) =>
    refusalsAsErrors(() => cmdInit(workspaceDir, loadConfig(workspaceDir), epicId, title)),
  );
  server.handle(startRpc, ({ workspaceDir, ref }) =>
    refusalsAsErrors(() => cmdStart(workspaceDir, loadConfig(workspaceDir), ref)),
  );
  server.handle(closeRpc, ({ workspaceDir, story }) =>
    refusalsAsErrors(() => cmdClose(workspaceDir, loadConfig(workspaceDir), story)),
  );
  server.handle(nextRpc, ({ workspaceDir, story }) =>
    refusalsAsErrors(() => deps.spawnNext({ root: workspaceDir, story })),
  );
  server.handle(isEpicRpc, ({ workspaceDir }) =>
    refusalsAsErrors(() => ({ epic: isEpicRepo(workspaceDir, loadConfig(workspaceDir)) })),
  );
}
