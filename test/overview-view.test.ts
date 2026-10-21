import { expect, test } from "vitest";
import {
  cardLines,
  groupProjects,
  groupsToRead,
  isReading,
  type OverviewEpic,
  type ProjectState,
  sections,
  visibleEpics,
  workspaceKey,
} from "../client/overview";
import type { WorkspaceInfo } from "../client/workspaces";

function ws(id: string, projectId: string, git = true): WorkspaceInfo {
  return { id, directory: `/${projectId}/${id}`, projectId, projectName: `name-${projectId}`, projectRoot: `/${projectId}`, git };
}

function epic(id: string, next: string, over: Partial<OverviewEpic> = {}): OverviewEpic {
  return {
    epic: id,
    title: `Title ${id}`,
    branch: `epic/${id}-x`,
    state: "in_progress",
    next,
    after: "none",
    rows: { total: 7, open: 2 },
    openPr: null,
    workspaceId: null,
    ...over,
  };
}

test("groupProjects keeps git projects only, one group per project with its workspaces", () => {
  const groups = groupProjects([ws("a", "p2"), ws("b", "p1"), ws("c", "p2"), ws("d", "p3", false)]);
  expect(groups).toEqual([
    { projectId: "p1", name: "name-p1", root: "/p1", workspaces: [{ id: "b", directory: "/p1/b" }] },
    {
      projectId: "p2",
      name: "name-p2",
      root: "/p2",
      workspaces: [
        { id: "a", directory: "/p2/a" },
        { id: "c", directory: "/p2/c" },
      ],
    },
  ]);
});

test("visibleEpics puts the newest epic first and hides closed ones unless asked", () => {
  const epics = [epic("E9", "TH-9"), epic("E10", "none"), epic("E2", ""), epic("E11", "TH-11")];
  expect(visibleEpics(epics, false).map((e) => e.epic)).toEqual(["E11", "E9", "E2"]);
  expect(visibleEpics(epics, true).map((e) => e.epic)).toEqual(["E11", "E10", "E9", "E2"]);
});

test("cardLines: heading, state and next, story counts", () => {
  expect(cardLines(epic("E10", "TH-E10-3", { title: "Identity and reach" }))).toEqual({
    heading: "E10 Identity and reach",
    status: "in_progress · next TH-E10-3",
    stories: "stories: 2 of 7 open",
  });
  expect(cardLines(epic("E9", "none", { state: "" })).status).toBe("closed");
  expect(cardLines(epic("E8", "")).status).toBe("in_progress");
});

test("sections: a project with no epic branches is not shown; an error shows in its own section", () => {
  const groups = groupProjects([ws("a", "p1"), ws("b", "p2"), ws("c", "p3"), ws("d", "p4")]);
  const states = new Map([
    ["p1", { phase: "ready" as const, epics: [epic("E1", "none")] }],
    ["p2", { phase: "ready" as const, epics: [] }],
    ["p3", { phase: "error" as const, error: "git failed" }],
    ["p4", { phase: "loading" as const }],
  ]);
  expect(sections(groups, states, false)).toEqual([
    { projectId: "p1", name: "name-p1", epics: [], hidden: 1, error: null },
    { projectId: "p3", name: "name-p3", epics: [], hidden: 0, error: "git failed" },
  ]);
  expect(sections(groups, states, true)[0]).toEqual({
    projectId: "p1",
    name: "name-p1",
    epics: [epic("E1", "none")],
    hidden: 0,
    error: null,
  });
});

test("groupsToRead: a new project, and one whose set of workspaces changed; not one whose workspaces only moved", () => {
  const [p1, p2] = groupProjects([ws("a", "p1"), ws("b", "p1"), ws("c", "p2")]);
  const read = new Map([
    ["p1", workspaceKey({ ...p1, workspaces: [...p1.workspaces].reverse() })],
    ["p2", workspaceKey(p2)],
  ]);
  expect(groupsToRead([p1, p2], read)).toEqual([]);
  const [q1, q2] = groupProjects([ws("a", "p1"), ws("c", "p2"), ws("d", "p2"), ws("e", "p3")]);
  expect(groupsToRead([q1, q2, ...groupProjects([ws("e", "p3")])], read).map((g) => g.projectId)).toEqual([
    "p1",
    "p2",
    "p3",
  ]);
});

test("isReading: before the first workspace list, and while a project has no answer yet", () => {
  const groups = groupProjects([ws("a", "p1"), ws("b", "p2")]);
  expect(isReading(null, new Map())).toBe(true);
  expect(isReading([], new Map())).toBe(false);
  expect(isReading(groups, new Map([["p1", { phase: "ready" as const, epics: [] }]]))).toBe(true);
  const settled = new Map<string, ProjectState>([
    ["p1", { phase: "ready" as const, epics: [] }],
    ["p2", { phase: "error" as const, error: "x" }],
  ]);
  expect(isReading(groups, settled)).toBe(false);
  expect(isReading(groups, new Map([...settled, ["p2", { phase: "loading" as const }]]))).toBe(true);
});
