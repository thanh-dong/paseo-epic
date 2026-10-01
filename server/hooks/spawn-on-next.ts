import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { SpawnNext } from "../core/types";

// The MCP process has no daemon SDK, so `epic_next` only reports
// "Spawn pending for <story>" and this hook performs the spawn when the turn ends.

const PENDING_RE = /Spawn pending for ([A-Z]{2,}-\d+)/;

/**
 * The spawn an `epic_next` tool call asked for in the current turn. The hook
 * gets the whole conversation, so only items after the latest user message
 * count; otherwise every later turn would see the same call again. The tool
 * name may carry an MCP prefix (`mcp__epic__epic_next`), and the result may
 * sit in any detail field, so the whole item is searched as text.
 */
export function pendingNextFromTimeline(
  timeline: readonly AgentTimelineItem[],
): { story: string; callId: string | null } | null {
  let start = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.type === "user_message") {
      start = i + 1;
      break;
    }
  }
  for (let i = timeline.length - 1; i >= start; i--) {
    const item = timeline[i] as { type?: unknown; name?: unknown; callId?: unknown; detail?: unknown };
    if (item?.type !== "tool_call" || typeof item.name !== "string" || !item.name.endsWith("epic_next")) continue;
    const match = PENDING_RE.exec(JSON.stringify(item.detail ?? null));
    if (match) return { story: match[1], callId: typeof item.callId === "string" ? item.callId : null };
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
    const key = `${event.agent.id}:${pending.callId ?? pending.story}`;
    if (handled.has(key)) return;
    handled.add(key);

    let text: string;
    try {
      // The pending line names the next story; `next` takes the closed one, which is the
      // last ledger entry of the agent's worktree (the same default the RPC uses).
      const out = await deps.spawnNextFor(paseo)({ root: deps.repoRoot(event.agent.cwd) });
      text = out.message;
    } catch (err) {
      text =
        `Spawn failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Start the next story by hand with /epic start ${pending.story}.`;
    }
    try {
      await paseo.agents.ref(event.agent.id).send(text);
    } catch (err) {
      console.error(`[paseo-epic] could not send the spawn result to ${event.agent.id}:`, err);
    }
  });
}
