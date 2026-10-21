// Pure helpers of the Epics screen: projects from the workspace list, the
// sections and cards to show. No React Native imports here: the tests run
// under node.

import type { output as ZodOutput } from "zod";
import type { overviewRpc } from "../shared/contracts";
import type { ProjectId, WorkspaceInfo } from "./workspaces";

export type OverviewEpic = ZodOutput<(typeof overviewRpc)["output"]>["epics"][number];

export interface ProjectGroup {
  projectId: string;
  name: string;
  root: string;
  workspaces: Array<{ id: string; directory: string }>;
}

/** One project's overview read: its epics (kept while a Refresh runs), or the error. */
export interface ProjectState {
  phase: "loading" | "ready" | "error";
  epics?: OverviewEpic[];
  error?: string;
}

export interface Section {
  projectId: string;
  name: string;
  epics: OverviewEpic[];
  /** Closed epics left out because Show closed is off. */
  hidden: number;
  error: string | null;
}

/** One group per git project, by name; non-git projects are skipped. */
export function groupProjects(list: readonly WorkspaceInfo[]): ProjectGroup[] {
  const groups = new Map<ProjectId, ProjectGroup>();
  for (const w of list) {
    if (!w.git) continue;
    let group = groups.get(w.projectId);
    if (!group) {
      group = { projectId: w.projectId, name: w.projectName, root: w.projectRoot, workspaces: [] };
      groups.set(w.projectId, group);
    }
    group.workspaces.push({ id: w.id, directory: w.directory });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Newest epic first (natural order of the ids, so E10 before E9); `next=none` only with Show closed. */
export function visibleEpics(epics: readonly OverviewEpic[], showClosed: boolean): OverviewEpic[] {
  return epics
    .filter((e) => showClosed || e.next !== "none")
    .sort((a, b) => b.epic.localeCompare(a.epic, undefined, { numeric: true }));
}

/** The text lines of an epic's card. */
export function cardLines(epic: OverviewEpic): { heading: string; status: string; stories: string } {
  const next = epic.next === "none" ? "closed" : epic.next ? `next ${epic.next}` : "";
  return {
    heading: `${epic.epic} ${epic.title}`,
    status: [epic.state, next].filter((s) => s.length > 0).join(" · "),
    stories: `stories: ${epic.rows.open} of ${epic.rows.total} open`,
  };
}

/**
 * The sections to show, in project order. A project with no epic branches
 * (or not read yet) is not shown; a failed read shows its error in its own
 * section, so one failing project does not hide the others.
 */
export function sections(
  groups: readonly ProjectGroup[],
  states: ReadonlyMap<ProjectId, ProjectState>,
  showClosed: boolean,
): Section[] {
  const out: Section[] = [];
  for (const g of groups) {
    const state = states.get(g.projectId);
    const all = state?.epics ?? [];
    const error = state?.phase === "error" ? (state.error ?? "") : null;
    if (error === null && all.length === 0) continue;
    const epics = visibleEpics(all, showClosed);
    out.push({ projectId: g.projectId, name: g.name, epics, hidden: all.length - epics.length, error });
  }
  return out;
}

/** The project's set of workspace ids, order-free; a new key means the project is read again. */
export function workspaceKey(group: ProjectGroup): string {
  return group.workspaces
    .map((w) => w.id)
    .sort()
    .join("\n");
}

/** The projects to read: those not read yet, and those whose set of workspaces changed since. */
export function groupsToRead(
  groups: readonly ProjectGroup[],
  readKeys: ReadonlyMap<ProjectId, string>,
): ProjectGroup[] {
  return groups.filter((g) => readKeys.get(g.projectId) !== workspaceKey(g));
}

/** True before the first workspace list, and while any project has no answer yet. */
export function isReading(groups: readonly ProjectGroup[] | null, states: ReadonlyMap<ProjectId, ProjectState>): boolean {
  if (groups === null) return true;
  return groups.some((g) => {
    const phase = states.get(g.projectId)?.phase;
    return phase === undefined || phase === "loading";
  });
}
