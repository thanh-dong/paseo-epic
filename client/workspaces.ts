// The selected host's workspace list, kept live through one owned
// subscription. The client entry starts one watcher; the header buttons and
// every open Epics screen listen to it. No React Native imports here: the
// tests run under node.

import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";

type PaseoApi = PluginCommandCapabilities["paseo"];
type Descriptor = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];

// Named id types also keep the mobile audit's HTML-tag pattern off generics like Set<…>.
export type WorkspaceId = string;
export type ProjectId = string;

/** The fields of a workspace that the header buttons and the Epics screen read. */
export interface WorkspaceInfo {
  id: WorkspaceId;
  directory: string;
  projectId: ProjectId;
  projectName: string;
  projectRoot: string;
  /** False for directory and non-git projects; the Epics screen skips them. */
  git: boolean;
}

/** The workspace as the plugin reads it; null for one with no directory. */
export function toInfo(w: Descriptor): WorkspaceInfo | null {
  if (!w.workspaceDirectory) return null;
  return {
    id: w.id,
    directory: w.workspaceDirectory,
    projectId: w.projectId,
    projectName: w.projectCustomName || w.projectDisplayName,
    projectRoot: w.projectRootPath,
    git: w.projectKind === "git",
  };
}

/** The daemon's page size for the workspace list (its default and its maximum). */
const PAGE_LIMIT = 200;

export type WorkspaceListener = (list: WorkspaceInfo[], changed: ReadonlySet<WorkspaceId>) => void;

export interface WorkspaceWatcher {
  /**
   * Call `listener` on every change with the whole list and the ids the
   * change is about: every id on a snapshot (the first one, and again after a
   * reconnect), the new ids of a later page, one id on an update. Once the
   * first snapshot is in, a new listener is called at once with every id.
   * Returns its remover.
   */
  listen(listener: WorkspaceListener): () => void;
  /** Drop every listener and release the subscription. Idempotent. */
  stop(): void;
}

/**
 * Watch the workspace list through one owned subscription. The snapshot
 * holds the first page only, so the later pages are read once with plain
 * `list` calls; an entry an update already brought is not overwritten.
 */
export function watchWorkspaces(workspaces: PaseoApi["workspaces"]): WorkspaceWatcher {
  const byId = new Map<WorkspaceId, WorkspaceInfo>();
  const listeners = new Set<WorkspaceListener>();
  let ready = false;
  let stopped = false;
  // A new snapshot (a reconnect) ends the page reads of the one before.
  let generation = 0;
  let release: (() => void) | null = null;
  const put = (w: Descriptor) => {
    const info = toInfo(w);
    if (info) byId.set(w.id, info);
    else byId.delete(w.id);
  };
  const notify = (changed: ReadonlySet<WorkspaceId>) => {
    const list = [...byId.values()];
    for (const listener of [...listeners]) listener(list, changed);
  };
  const readPages = async (cursor: string | null, gen: number) => {
    while (cursor !== null) {
      const page = await workspaces.list({ page: { limit: PAGE_LIMIT, cursor } });
      if (stopped || gen !== generation) return;
      const added = new Set<WorkspaceId>();
      for (const w of page.entries) {
        if (byId.has(w.id)) continue;
        put(w);
        if (byId.has(w.id)) added.add(w.id);
      }
      if (added.size > 0) notify(added);
      cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
    }
  };
  workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      release = () => {
        subscription.release().catch(() => {});
      };
      if (stopped) return release();
      subscription.subscribe({
        snapshot: ({ entries, pageInfo }) => {
          const gen = ++generation;
          byId.clear();
          for (const w of entries) put(w);
          ready = true;
          notify(new Set(byId.keys()));
          if (pageInfo.hasMore) {
            readPages(pageInfo.nextCursor, gen).catch((err) => {
              if (!stopped) console.error("[epic] reading the workspace list failed", err);
            });
          }
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          const id = update.kind === "upsert" ? update.workspace.id : update.id;
          if (update.kind === "upsert") put(update.workspace);
          else byId.delete(id);
          notify(new Set([id]));
        },
      });
      return undefined;
    })
    .catch((err) => {
      if (!stopped) console.error("[epic] the workspace list subscription failed", err);
    });
  return {
    listen(listener) {
      listeners.add(listener);
      if (ready) listener([...byId.values()], new Set(byId.keys()));
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      listeners.clear();
      release?.();
    },
  };
}
