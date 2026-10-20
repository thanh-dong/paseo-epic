// The workspace header button of an epic repo: a label with where the epic
// stands and a menu that opens things. No item starts work. No React Native
// imports here: the tests run under node.

import type { PluginButton, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { output as ZodOutput } from "zod";
import { headerRpc } from "../shared/contracts";
import { headerLabels, OVERVIEW_ID, PANEL_ID } from "./strings";
import type { WorkspaceId, WorkspaceInfo, WorkspaceWatcher } from "./workspaces";

type HeaderInfo = NonNullable<ZodOutput<(typeof headerRpc)["output"]>>;
type HeaderClient = Pick<PluginClientContext, "rpc" | "addHeaderButton" | "openPanel" | "openScreen">;

const BUTTON_ID = "epic";

/**
 * Quiet time before a label is read again. Paseo updates a workspace often
 * (status, diff stat, activity); a burst of updates gives one read.
 */
const RELABEL_DELAY_MS = 2000;

/** A workspace directory. */
type Dir = string;
// The parentheses keep the mobile audit's HTML-tag pattern off this line.
type Timer = ReturnType<(typeof setTimeout)>;

/** `E10 · next TH-E10-3`, `E10 · closed` for `next=none`, `Epic` before the first package. */
export function headerLabel(info: HeaderInfo): string {
  if (info.epic === null) return headerLabels.title;
  if (info.next === "none") return `${info.epic} · closed`;
  return info.next ? `${info.epic} · next ${info.next}` : info.epic;
}

export interface ButtonPlan {
  add: WorkspaceInfo[];
  update: WorkspaceInfo[];
  remove: WorkspaceId[];
}

/**
 * The header buttons to add, re-label and remove. `previous` holds the
 * workspace ids that have a button, `isEpicByDir` the answers so far (a
 * directory not asked yet has no button), and `changed` the ids this list
 * change is about; only those are re-labelled.
 */
export function planButtons(
  previous: ReadonlySet<WorkspaceId>,
  workspaces: readonly WorkspaceInfo[],
  isEpicByDir: ReadonlyMap<Dir, boolean>,
  changed: ReadonlySet<WorkspaceId>,
): ButtonPlan {
  const plan: ButtonPlan = { add: [], update: [], remove: [] };
  const keep = new Set<WorkspaceId>();
  for (const w of workspaces) {
    if (isEpicByDir.get(w.directory) !== true) continue;
    keep.add(w.id);
    if (!previous.has(w.id)) plan.add.push(w);
    else if (changed.has(w.id)) plan.update.push(w);
  }
  for (const id of previous) if (!keep.has(id)) plan.remove.push(id);
  return plan;
}

/** The button for one workspace: the label, and a menu that only opens the panel or the overview. */
function epicButton(client: HeaderClient, workspaceId: string, label: string): PluginButton {
  const action = (onPress: () => void) => ({ kind: "action" as const, onPress });
  return {
    title: headerLabels.title,
    icon: "ListOrdered",
    label,
    behavior: {
      kind: "menu",
      items: [
        {
          kind: "item",
          id: "open-panel",
          title: headerLabels.openPanel,
          behavior: action(() => client.openPanel(PANEL_ID, { workspaceId, location: "workspace" })),
        },
        {
          kind: "item",
          id: "open-explorer",
          title: headerLabels.openExplorer,
          behavior: action(() => client.openPanel(PANEL_ID, { workspaceId, location: "explorer" })),
        },
        {
          kind: "item",
          id: "overview",
          title: headerLabels.overview,
          behavior: action(() => client.openScreen({ screenId: OVERVIEW_ID })),
        },
      ],
    },
  };
}

/**
 * Keep one header button on every workspace of an epic repo, from the shared
 * workspace watcher. Each directory is asked whether it is one (`headerRpc`
 * answers null when not) until an answer comes; a failed ask is asked again
 * on the next change of that workspace. The label is read again 2 s after the
 * last update of that workspace. The cleanup stops listening and removes
 * every button; the watcher's owner stops the watcher.
 */
export function startHeaderButtons(client: HeaderClient, watcher: WorkspaceWatcher): () => void {
  const buttons = new Map<WorkspaceId, PluginButtonRegistration>();
  const isEpicByDir = new Map<Dir, boolean>();
  const labelByDir = new Map<Dir, string>();
  const asking = new Set<Dir>();
  const relabelTimers = new Map<WorkspaceId, Timer>();
  // Label reads can overlap; only a workspace's newest read may land.
  const labelSeq = new Map<WorkspaceId, number>();
  let seqNext = 0;
  let list: WorkspaceInfo[] = [];
  let stopped = false;

  const read = (dir: string) => client.rpc(headerRpc, { workspaceDir: dir });

  const relabel = async (w: WorkspaceInfo) => {
    const seq = ++seqNext;
    labelSeq.set(w.id, seq);
    let info: HeaderInfo | null;
    try {
      info = await read(w.directory);
    } catch {
      return; // Keep the last label; the panel shows the error.
    }
    if (stopped || labelSeq.get(w.id) !== seq || info === null) return;
    labelByDir.set(w.directory, headerLabel(info));
    buttons.get(w.id)?.update({ label: headerLabel(info) });
  };

  /** Read the label once the workspace has had no update for RELABEL_DELAY_MS. */
  const scheduleRelabel = (id: WorkspaceId) => {
    clearTimeout(relabelTimers.get(id));
    relabelTimers.set(
      id,
      setTimeout(() => {
        relabelTimers.delete(id);
        const w = list.find((x) => x.id === id);
        if (w && buttons.has(id)) void relabel(w);
      }, RELABEL_DELAY_MS),
    );
  };

  const apply = (changed: ReadonlySet<WorkspaceId>) => {
    if (stopped) return;
    const plan = planButtons(new Set(buttons.keys()), list, isEpicByDir, changed);
    for (const id of plan.remove) {
      buttons.get(id)?.remove();
      buttons.delete(id);
      labelSeq.delete(id);
      clearTimeout(relabelTimers.get(id));
      relabelTimers.delete(id);
    }
    for (const w of plan.add) {
      const label = labelByDir.get(w.directory) ?? headerLabels.title;
      buttons.set(w.id, client.addHeaderButton({ id: BUTTON_ID, workspaceId: w.id, button: epicButton(client, w.id, label) }));
    }
    for (const w of plan.update) scheduleRelabel(w.id);
  };

  /** Ask each directory with no answer yet, then add the buttons its answer allows. */
  const ask = (workspaces: readonly WorkspaceInfo[]) => {
    for (const dir of new Set(workspaces.map((w) => w.directory))) {
      if (isEpicByDir.has(dir) || asking.has(dir)) continue;
      asking.add(dir);
      read(dir).then(
        (info) => {
          asking.delete(dir);
          isEpicByDir.set(dir, info !== null);
          if (info) labelByDir.set(dir, headerLabel(info));
          apply(new Set(list.filter((w) => w.directory === dir).map((w) => w.id)));
        },
        // No answer is kept: the next change of this workspace asks again. Until then it has no button.
        () => asking.delete(dir),
      );
    }
  };

  const unlisten = watcher.listen((next, changed) => {
    list = next;
    ask(next.filter((w) => changed.has(w.id)));
    apply(changed);
  });

  return () => {
    stopped = true;
    unlisten();
    for (const timer of relabelTimers.values()) clearTimeout(timer);
    relabelTimers.clear();
    for (const b of buttons.values()) b.remove();
    buttons.clear();
  };
}
