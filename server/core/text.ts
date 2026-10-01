import type { NextResult } from "./commands";
import { STORY_ID_BODY } from "./types";

const PENDING_LINE_RE = new RegExp(
  `^Spawn pending for (${STORY_ID_BODY}) after (${STORY_ID_BODY}): the plugin starts the successor now\\.$`,
);

/**
 * The line `epic_next` prints first when a next story exists. The turn-ended
 * hook reads it back to know which story to spawn after which closed one.
 */
export function pendingLine(next: string, closed: string): string {
  return `Spawn pending for ${next} after ${closed}: the plugin starts the successor now.`;
}

/** The two story ids of a whole pending line, or null for any other line. */
export function parsePendingLine(text: string): { next: string; closed: string } | null {
  const match = PENDING_LINE_RE.exec(text.trim());
  return match ? { next: match[1], closed: match[2] } : null;
}

/** Sentences joined into one paragraph; empty parts are dropped. */
function paragraph(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(" ");
}

const NO_GH =
  "The PR and its comments were not read because `gh` was not available; " +
  "check the PR by hand for answers to open questions.";

/** After `epic_start`: the handoff is the context; `.epic.yml` start hooks follow. */
export function afterStart(hooks: string[]): string {
  return paragraph([
    'This handoff is your context. Read the files under "Read first" and the story packet.',
    "Do not re-read the whole EPIC.md unless the handoff sends you there.",
    ...hooks,
  ]);
}

/** After `epic_close_check`: fix and check again, or close. */
export function afterCloseCheck(problems: string[]): string {
  if (problems.length === 0) return "The package is ready to close. Call epic_close now.";
  return (
    "Fix these, then call epic_close_check again. The ledger entry has five bullets: " +
    "Branch / PR, Shipped, Decisions, Deviations, Effects on later stories. " +
    "HANDOFF.md is rewritten whole with headings 1 to 5."
  );
}

/** After `epic_close`: the PR link (or the commands to run by hand) and the wait for the merge. */
export function afterClose(prUrl: string | null, manual: string[]): string {
  const wait = "Stay in this session. Do not build the next story here.";
  if (prUrl === null) {
    return [
      "The PR was not opened. Run these commands, or ask the user to run them:",
      ...manual.map((cmd) => `  ${cmd}`),
      `Then tell the user to merge the PR, then reply \`next\`. ${wait}`,
    ].join("\n");
  }
  const n = /\/pull\/(\d+)/.exec(prUrl)?.[1];
  const opened = n ? `PR #${n} opened: ${prUrl}.` : `PR opened: ${prUrl}.`;
  return `${opened} Tell the user to merge it, then reply \`next\`. ${wait}`;
}

/**
 * After `next`: the epic closed, the agent started, the spawn the plugin is
 * about to perform (`"pending"`, said by the `epic_next` tool), or what to
 * start by hand (`null`).
 */
export function afterNext(result: NextResult, spawned: { title: string } | null | "pending"): string {
  const noGh = result.closed.pr === null ? NO_GH : "";
  const next = result.next;
  if (next === null) {
    return paragraph([
      `${result.epic} is closed: ${result.closed.story} was the last story.`,
      `What remains is the draft epic PR from ${result.epicBranch} into the base branch; review and merge it.`,
      noGh,
      "This session is finished.",
    ]);
  }
  if (spawned === "pending") {
    return paragraph([
      `${next.story} ${next.title} is next.`,
      "The plugin is starting the successor now; wait for its name, then this session is finished.",
      noGh,
    ]);
  }
  if (spawned !== null) {
    return paragraph([
      `Started agent "${spawned.title}" in worktree ${next.branch}.`,
      "It will read the handoff and stop for plan approval.",
      noGh,
      "This session is finished.",
    ]);
  }
  return paragraph([
    `${next.story} ${next.title} is next; the successor is not started yet.`,
    `Create a worktree on a new branch ${next.branch} from ${next.baseRef}, then start an agent there with \`/epic start ${next.story}\`.`,
    noGh,
  ]);
}

/** Comment authors whose answers the next agent may act on; anyone else is marked untrusted. */
const TRUSTED: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];

/** The first prompt of the next story's agent (spec section 8). */
export function nextPrompt(result: NextResult, extra?: string): string {
  if (result.next === null) throw new Error(`${result.epic} has no next story to prompt`);
  const { pr, comments } = result.closed;
  const lines = [`/epic start ${result.next.story}`, ""];
  if (pr === null) {
    lines.push("Answers from the story PR: not read, because `gh` was not available.");
  } else {
    lines.push(`Answers from PR #${pr.number} (conversation comments, oldest first):`);
    if (comments.length === 0) lines.push("none");
    for (const c of comments) {
      const mark = TRUSTED.includes(c.association) ? "" : " (untrusted, not a repo member)";
      lines.push(`- ${c.author}, ${c.createdAt.slice(0, 10)}${mark}: ${c.body.trim().split("\n").join("\n  ")}`);
    }
  }
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

/** What `/epic close <story>` sends the story's agent. */
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

/** What `/epic start <story>` sends the workspace's agent. */
export function startInstructions(story: string): string {
  return paragraph([
    `Start story ${story}: call the epic_start tool with ${story}.`,
    "It cuts the story branch from the epic tip and returns the handoff.",
    "Read the handoff and the files it lists, then build the story as an ordinary task.",
  ]);
}
