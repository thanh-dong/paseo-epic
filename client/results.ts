// Hand-off from the slash command and the Command Center item to the Epic
// panel. A command posts its result for a workspace directory and opens the
// panel; the panel takes the result, re-reads the status, and shows it. The
// panel may already be open, so it also listens for new posts.

export interface PanelResult {
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

/** The text of a thrown RPC error; YAML errors keep their line breaks. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
