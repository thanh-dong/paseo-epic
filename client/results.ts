// Hand-off from the slash command and the Command Center item to the Epic
// panel. A command posts its result for a workspace directory and opens the
// panel; the panel takes the result, re-reads the status, and shows it. The
// panel may already be open, so it also listens for new posts.

import type { output as ZodOutput } from "zod";
import type { statusRpc } from "../shared/contracts";

type StatusContract = typeof statusRpc;
export type Status = ZodOutput<StatusContract["output"]>;

export interface PanelResult {
  /**
   * The epic or story id the panel reads status for, kept for later reads and
   * button presses. `null` goes back to the default package; absent keeps the
   * current one.
   */
  ref?: string | null;
  /** Status the command already read for `ref`; the panel shows it as is. */
  status?: Status;
  /** The `next` message. */
  message?: string;
  /** Check problems; an empty list shows "Last check: ok". */
  problems?: string[];
  /** RPC error text, shown inline. */
  error?: string;
}

const pending = new Map<string, PanelResult>();
const listeners = new Set<() => void>();

export function postResult(workspaceDir: string, result: PanelResult): void {
  pending.set(workspaceDir, result);
  for (const listener of listeners) listener();
}

/** The posted result for this directory, removed so it shows once. */
export function takeResult(workspaceDir: string): PanelResult | undefined {
  const result = pending.get(workspaceDir);
  pending.delete(workspaceDir);
  return result;
}

export function onResult(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The last path segment of a package folder. */
export function folderName(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

/** The text of a thrown RPC error; YAML errors keep their line breaks. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
