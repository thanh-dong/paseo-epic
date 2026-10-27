import type { PluginServerContext } from "@getpaseo/plugin/server";
import { parsePendingLine } from "../core/text";
import type { SpawnNext } from "../core/types";
import type { AgentTimelineItem, PaseoApi } from "../sdk-types";

// The MCP process has no daemon SDK, so `epic_next` prints a pending line
// ("Spawn pending for <next> after <closed>: ...") as the first line of its
// output, and this hook performs the spawn when the turn ends.

/** The tool name, bare or with an MCP server prefix (`mcp__epic__epic_next`). */
const EPIC_NEXT_RE = /(?:^|__|[.:/])epic_next$/;

/**
 * The text a tool call returned: every string in its detail except the
 * input, so the announced ids come from what the tool said, never from what
 * the agent sent. Providers shape the output differently (a string, MCP
 * `content` parts, ...), so the detail is walked rather than read by shape.
 */
function outputTexts(detail: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key: string | null): void => {
    if (key === "input") return;
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) walk(v, null);
    else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(detail, null);
  return out;
}

/**
 * The spawn an `epic_next` tool call asked for in the current turn. The hook
 * gets the whole conversation, so only items after the latest user message
 * count; otherwise every later turn would see the same call again. The output
 * is read line by line and only a whole pending line counts: the PR comments
 * inside the JSON are escaped onto one line each, so a comment cannot forge one.
 */
export function pendingNextFromTimeline(
  timeline: readonly AgentTimelineItem[],
): { next: string; closed: string; provider?: string; callId: string | null } | null {
  let start = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.type === "user_message") {
      start = i + 1;
      break;
    }
  }
  for (let i = timeline.length - 1; i >= start; i--) {
    const item = timeline[i] as { type?: unknown; name?: unknown; callId?: unknown; detail?: unknown };
    if (item?.type !== "tool_call" || typeof item.name !== "string" || !EPIC_NEXT_RE.test(item.name)) continue;
    for (const text of outputTexts(item.detail)) {
      for (const line of text.split(/\r?\n/)) {
        const pending = parsePendingLine(line);
        if (pending) return { ...pending, callId: typeof item.callId === "string" ? item.callId : null };
      }
    }
  }
  return null;
}

const log = (message: string): void => console.log(`[paseo-epic] spawn-on-next: ${message}`);

/** How many of the newest timeline entries to read; `epic_next` ends a story's turn, so it is near the tail. */
const TAIL_LIMIT = 50;

/**
 * The items of the turn that just ended. Paseo 0.12 put the timeline in the
 * event; 0.13 always sends it empty, so the tail is read from the daemon and
 * cut to the entries of this turn (an autonomous turn has no user message, so
 * the turn id is the only safe boundary). When no entry has the turn id, the
 * whole tail is used and `pendingNextFromTimeline` cuts at the latest user
 * message, as on 0.12. Returns null, after logging why, when the read fails.
 */
async function turnTimeline(
  paseo: PaseoApi,
  agentId: string,
  turnId: string | null,
  timeline: readonly AgentTimelineItem[],
): Promise<readonly AgentTimelineItem[] | null> {
  if (timeline.length > 0) return timeline;
  let page: Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;
  try {
    page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TAIL_LIMIT });
  } catch (err) {
    console.error(`[paseo-epic] spawn-on-next: could not read the timeline of ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (page.error) {
    console.error(`[paseo-epic] spawn-on-next: could not read the timeline of ${agentId}: ${page.error}`);
    return null;
  }
  const inTurn = turnId === null ? [] : page.entries.filter((entry) => entry.turnId === turnId);
  if (inTurn.length > 0) return inTurn.map((entry) => entry.item);
  log(`no timeline entry has turn id ${turnId ?? "(none)"} for ${agentId}; reading the last ${page.entries.length} entries`);
  return page.entries.map((entry) => entry.item);
}

/**
 * On a completed turn whose `epic_next` call reported a pending spawn, run
 * the spawn and send its message to the agent. A failure is sent as text;
 * nothing throws out of the hook. Each tool call spawns at most once. Every
 * return is logged, so a spawn that does not happen says why in the plugin logs.
 */
export function registerSpawnOnNext(
  server: PluginServerContext,
  deps: { spawnNextFor: (paseo: PaseoApi) => SpawnNext; repoRoot: (cwd: string) => string },
): () => void {
  const handled = new Set<string>();
  return server.on("agent.turn_ended", async (event, { paseo }) => {
    const turn = `turn ${event.turnId ?? "(no id)"} of ${event.agent.id}`;
    if (event.outcome.kind !== "completed") {
      log(`${turn} ended ${event.outcome.kind}, not completed; no spawn`);
      return;
    }
    const timeline = await turnTimeline(paseo, event.agent.id, event.turnId, event.timeline);
    if (!timeline) return;
    const pending = pendingNextFromTimeline(timeline);
    if (!pending) {
      log(`no epic_next pending line in ${turn}; no spawn`);
      return;
    }
    const key = `${event.agent.id}:${pending.callId ?? pending.next}`;
    if (handled.has(key)) {
      log(`epic_next call ${pending.callId ?? pending.next} in ${turn} was already handled; no spawn`);
      return;
    }
    handled.add(key);
    log(`spawning ${pending.next} after ${pending.closed} for ${event.agent.id}`);

    let text: string;
    try {
      // The provider the user named, else the one this session runs on.
      const out = await deps.spawnNextFor(paseo)({
        root: deps.repoRoot(event.agent.cwd),
        story: pending.closed,
        provider: pending.provider ?? event.agent.provider,
      });
      const found = out.next?.story ?? "none";
      text =
        found === pending.next
          ? out.message
          : `Spawn mismatch: the plugin found ${found} as the next story but the agent announced ${pending.next}; ` +
            `start the next story by hand: tell a fresh agent in its worktree to call epic_start with ${pending.next}.`;
    } catch (err) {
      text =
        `Spawn failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Start the next story by hand: tell a fresh agent in its worktree to call epic_start with ${pending.next}.`;
    }
    log(`result for ${event.agent.id}: ${text}`);
    try {
      await paseo.agents.ref(event.agent.id).send(text);
    } catch (err) {
      console.error(`[paseo-epic] could not send the spawn result to ${event.agent.id}:`, err);
    }
  });
}
