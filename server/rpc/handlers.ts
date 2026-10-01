import type { PaseoApi } from "@getpaseo/client";
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
import { cmdCheck, cmdClose, cmdInit, cmdNext, cmdStart, cmdStatus } from "../core/commands";
import { loadConfig } from "../core/config";
import { localBranchExists } from "../core/git";
import { isEpicRepo } from "../core/locate";
import { EpicError, type SpawnNext } from "../core/types";
import { createSpawnNext } from "./next";

/** Run `fn`; a refusal becomes a plain Error with the same text, so the client shows it inline. */
async function refusalsAsErrors<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EpicError) throw new Error(err.message);
    throw err;
  }
}

/** The workspace whose checkout is on `branch`, read page by page from the daemon. */
export async function findWorkspaceByBranch(
  paseo: PaseoApi,
  branch: string,
): Promise<{ id: string; directory: string } | null> {
  let cursor: string | undefined;
  for (;;) {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    const hit = page.entries.find((w) => w.gitRuntime?.currentBranch === branch);
    if (hit) return { id: hit.id, directory: hit.workspaceDirectory ?? "" };
    if (!page.pageInfo?.hasMore || !page.pageInfo.nextCursor) return null;
    cursor = page.pageInfo.nextCursor;
  }
}

/** The `next` spawn on the daemon SDK of one handler or hook call. */
export function spawnNextFor(paseo: PaseoApi): SpawnNext {
  return createSpawnNext({
    paseo,
    config: loadConfig,
    next: cmdNext,
    findWorkspaceByBranch: (branch) => findWorkspaceByBranch(paseo, branch),
    localBranchExists,
  });
}

/** Wire every RPC contract to the core, with `workspaceDir` as the repo root. */
export function registerHandlers(
  server: PluginServerContext,
  deps: { spawnNextFor: (paseo: PaseoApi) => SpawnNext },
): void {
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
  server.handle(nextRpc, ({ workspaceDir, story, ref }, { paseo }) =>
    refusalsAsErrors(() => deps.spawnNextFor(paseo)({ root: workspaceDir, story, ref })),
  );
  server.handle(isEpicRpc, ({ workspaceDir }) =>
    refusalsAsErrors(() => ({ epic: isEpicRepo(workspaceDir, loadConfig(workspaceDir)) })),
  );
}
