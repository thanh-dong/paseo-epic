// The selected host's workspace list, kept live through one owned
// subscription. The header buttons and the Epics screen both read it. No
// React Native imports here: the tests run under node.

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

/**
 * Watch the workspace list. `onChange` gets the whole list and the ids the
 * change is about: every id on a snapshot (the first one, and again after a
 * reconnect), one id on an update. The cleanup releases the subscription.
 */
export function watchWorkspaces(
  workspaces: PaseoApi["workspaces"],
  onChange: (list: WorkspaceInfo[], changed: ReadonlySet<WorkspaceId>) => void,
): () => void {
  const byId = new Map<WorkspaceId, WorkspaceInfo>();
  let stopped = false;
  let release: (() => void) | null = null;
  const put = (w: Descriptor) => {
    const info = toInfo(w);
    if (info) byId.set(w.id, info);
    else byId.delete(w.id);
  };
  workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (stopped) return subscription.release();
      release = () => void subscription.release();
      subscription.subscribe({
        snapshot: ({ entries }) => {
          byId.clear();
          for (const w of entries) put(w);
          onChange([...byId.values()], new Set(byId.keys()));
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          const id = update.kind === "upsert" ? update.workspace.id : update.id;
          if (update.kind === "upsert") put(update.workspace);
          else byId.delete(id);
          onChange([...byId.values()], new Set([id]));
        },
      });
      return undefined;
    })
    .catch((err) => {
      if (!stopped) console.error("[epic] the workspace list subscription failed", err);
    });
  return () => {
    stopped = true;
    release?.();
  };
}
