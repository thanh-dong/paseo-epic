// Pure strings for the client. The client bundle cannot import server/, so
// the instruction text repeats server/core/text.ts; test/strings.test.ts
// keeps the two copies equal. No React Native imports here: the test runs
// under node.

/** Sentences joined into one paragraph; empty parts are dropped. */
function paragraph(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(" ");
}

/** What `/epic close` sends the story's agent: the close lines, one per line, then the call. */
export function closeInstructions(story: string, hooks: string[]): string {
  return [...hooks, `Call epic_close with ${story}.`].join("\n");
}

/** What `/epic start` sends the workspace's agent. */
export function startInstructions(story: string): string {
  return paragraph([
    `Start story ${story}: call the epic_start tool with ${story}.`,
    "It cuts the story branch from the epic tip and returns the handoff.",
    "Read the handoff and the files it lists, then build the story as an ordinary task.",
  ]);
}

export const USAGE = "Usage: /epic <init|start|close|next|status> [id]";

export function noAgent(verb: string): string {
  return `No agent in this workspace; create one, then run /epic ${verb} again.`;
}

/** The Epic panel's id. */
export const PANEL_ID = "epic";
/** The Epics overview screen's id. */
export const OVERVIEW_ID = "epic-overview";

/** The workspace header button and its menu. None of the items starts work. */
export const headerLabels = {
  title: "Epic",
  openPanel: "Open Epic panel",
  openExplorer: "Open in Explorer",
  overview: "Epic overview",
} as const;

/** The Epics screen and its sidebar item. */
export const overviewLabels = {
  title: "Epics",
  refresh: "Refresh",
  showClosed: "Show closed",
  reading: "Reading the epic branches…",
  none: "No project on this host has an epic branch on origin.",
  openWorkspace: "Open workspace",
  openPanel: "Open panel",
  noPr: "PR: none",
} as const;

/** The line under a project whose epics are all closed and hidden. */
export function closedHidden(count: number): string {
  return `${count} closed ${count === 1 ? "epic" : "epics"} hidden`;
}

export const labels = {
  loading: "Reading the epic package…",
  noEpic: 'This workspace has no epic package. Create one with /epic init <epic> "<title>", or ask an agent to call epic_init.',
  startNext: "Start next story",
  working: "Working…",
  columns: { story: "Story", lane: "Lane", status: "Status", done: "Done" },
  noStories: "No stories in the table yet.",
  waitingForMerge: "waiting for merge",
  refresh: "Refresh",
  openWorkspace: "Open workspace",
  openAgent: "Open agent",
  workspace: "workspace",
  agent: "agent",
  pr: "PR",
  noPr: "none yet",
  uncommitted: "uncommitted",
  noChanges: "No changes yet.",
  loadingRow: "Reading the story…",
} as const;

/** The heading of a story's changed-file list. */
export function changesVs(base: string, files: number, uncommitted: number): string {
  return `changes vs ${base}: ${files} files, ${uncommitted} uncommitted`;
}
