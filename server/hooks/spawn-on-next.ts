import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { parsePendingLine } from "../core/text";
import type { SpawnNext } from "../core/types";

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
): { next: string; closed: string; callId: string | null } | null {
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

/**
 * On a completed turn whose `epic_next` call reported a pending spawn, run
 * the spawn and send its message to the agent. A failure is sent as text;
 * nothing throws out of the hook. Each tool call spawns at most once.
 */
export function registerSpawnOnNext(
  server: PluginServerContext,
  deps: { spawnNextFor: (paseo: PaseoApi) => SpawnNext; repoRoot: (cwd: string) => string },
): () => void {
  const handled = new Set<string>();
  return server.on("agent.turn_ended", async (event, { paseo }) => {
    if (event.outcome.kind !== "completed") return;
    const pending = pendingNextFromTimeline(event.timeline);
    if (!pending) return;
    const key = `${event.agent.id}:${pending.callId ?? pending.next}`;
    if (handled.has(key)) return;
    handled.add(key);

    let text: string;
    try {
      const out = await deps.spawnNextFor(paseo)({ root: deps.repoRoot(event.agent.cwd), story: pending.closed });
      const found = out.next?.story ?? "none";
      text =
        found === pending.next
          ? out.message
          : `Spawn mismatch: the plugin found ${found} as the next story but the agent announced ${pending.next}; ` +
            `start the next story by hand with /epic start ${pending.next}.`;
    } catch (err) {
      text =
        `Spawn failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Start the next story by hand with /epic start ${pending.next}.`;
    }
    try {
      await paseo.agents.ref(event.agent.id).send(text);
    } catch (err) {
      console.error(`[paseo-epic] could not send the spawn result to ${event.agent.id}:`, err);
    }
  });
}
