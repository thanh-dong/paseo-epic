// Pure strings for the client. The client bundle cannot import server/, so
// the instruction text repeats server/core/text.ts; test/strings.test.ts
// keeps the two copies equal. No React Native imports here: the test runs
// under node.

/** Sentences joined into one paragraph; empty parts are dropped. */
function paragraph(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(" ");
}

/** What `/epic close` sends the story's agent. */
export function closeInstructions(story: string, hooks: string[]): string {
  return paragraph([
    `Close story ${story}. Update the epic package by hand:`,
    `set the ${story} row to \`implemented\` with Done \`YYYY-MM-DD PR #n\` (\`PR pending\` while the number is not known);`,
    `append the ledger entry \`### ${story} — YYYY-MM-DD\` with five bullets:`,
    "Branch / PR, Shipped, Decisions, Deviations, Effects on later stories;",
    `rewrite HANDOFF.md whole with headings 1 to 5 and the header \`after=${story}\`.`,
    ...hooks,
    `Then call epic_close_check with ${story} until it reports ready, and call epic_close with ${story}.`,
  ]);
}

/** What `/epic start` sends the workspace's agent. */
export function startInstructions(story: string): string {
  return paragraph([
    `Start story ${story}: call the epic_start tool with ${story}.`,
    "It cuts the story branch from the epic tip and returns the handoff.",
    "Read the handoff and the files it lists, then build the story as an ordinary task.",
  ]);
}

export const USAGE = "Usage: /epic <init|start|close|next|check|status> [id]";

export function noAgent(verb: string): string {
  return `No agent in this workspace; create one, then run /epic ${verb} again.`;
}

export const labels = {
  loading: "Reading the epic package…",
  noEpic: 'This workspace has no epic package. Run /epic init E1 "Title".',
  check: "Check",
  startNext: "Start next story",
  working: "Working…",
  columns: { story: "Story", lane: "Lane", status: "Status", done: "Done" },
  noStories: "No stories in the table yet.",
  waitingForMerge: "waiting for merge",
  lastCheckOk: "Last check: ok",
  lastCheckProblems: "Last check: problems",
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
