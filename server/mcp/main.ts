import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeProblems, cmdCheck, cmdClose, cmdNext, cmdStart, cmdStatus } from "../core/commands";
import { loadConfig } from "../core/config";
import { afterClose, afterCloseCheck, afterNext, afterStart } from "../core/text";
import { EpicError } from "../core/types";

// The stdio MCP server the create hook gives every agent in an epic repo.
// stdout belongs to the MCP transport; nothing else may write to it.

const root = process.argv[2];
if (!root) {
  process.stderr.write("usage: node epic-mcp.mjs <repo-root>\n");
  process.exit(2);
}

type ToolAnswer = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * Run a tool: the result as pretty JSON, a blank line, then what to do now.
 * A refusal comes back as an error result with its message, never thrown.
 */
async function answer(fn: () => Promise<{ result: unknown; next: string }>): Promise<ToolAnswer> {
  try {
    const { result, next } = await fn();
    return { content: [{ type: "text", text: `${JSON.stringify(result, null, 2)}\n\n${next}` }] };
  } catch (err) {
    if (err instanceof EpicError) return { content: [{ type: "text", text: err.message }], isError: true };
    throw err;
  }
}

const server = new McpServer({ name: "epic", version: "0.1.0" });
const story = { story: z.string() };

server.registerTool(
  "epic_status",
  {
    description: "Call to see the epic package this repo is on: its state, story rows, next story and problems.",
    inputSchema: {},
  },
  () =>
    answer(async () => {
      const result = await cmdStatus(root, loadConfig(root));
      let next: string;
      if (result.problems.length > 0) next = "The package has problems. Fix the listed problems, then call epic_check.";
      else if (result.next === "none" || result.next === "") next = `${result.epic} has no open story.`;
      else next = `The next open story is ${result.next}. To begin it, call epic_start with ${result.next}.`;
      return { result, next };
    }),
);

server.registerTool(
  "epic_start",
  {
    description:
      "Call when told to start a story: it cuts the story branch from the epic tip and returns the handoff to read.",
    inputSchema: story,
  },
  ({ story: id }) =>
    answer(async () => {
      const config = loadConfig(root);
      const result = await cmdStart(root, config, id, {});
      return { result, next: afterStart(config.hooks.start) };
    }),
);

server.registerTool(
  "epic_close_check",
  {
    description:
      "Call after updating the story row, ledger entry and HANDOFF.md, to list what still stops the story from closing.",
    inputSchema: story,
  },
  ({ story: id }) =>
    answer(async () => {
      const problems = await closeProblems(root, loadConfig(root), id);
      return { result: { problems }, next: afterCloseCheck(problems) };
    }),
);

server.registerTool(
  "epic_close",
  {
    description:
      "Call once epic_close_check reports ready: it commits the epic folder, pushes, and opens the story PR.",
    inputSchema: story,
  },
  ({ story: id }) =>
    answer(async () => {
      const result = await cmdClose(root, loadConfig(root), id, {});
      return { result, next: afterClose(result.pr?.url ?? null, result.manual) };
    }),
);

server.registerTool(
  "epic_next",
  {
    description:
      "Call when the user replies `next` after the story PR merged: it confirms the merge and names the next story.",
    inputSchema: story,
  },
  ({ story: id }) =>
    answer(async () => {
      const result = await cmdNext(root, loadConfig(root), id, {});
      const lines = [afterNext(result, null)];
      if (result.next !== null) {
        lines.push(`Spawn pending for ${result.next.story}: the plugin starts the successor now.`);
      }
      return { result, next: lines.join("\n") };
    }),
);

server.registerTool(
  "epic_check",
  {
    description: "Call to lint an epic package (or every package when no epic id is given) after editing it.",
    inputSchema: { epic: z.string().optional() },
  },
  ({ epic }) =>
    answer(async () => {
      const result = await cmdCheck(root, loadConfig(root), epic);
      const clean = result.every((r) => r.problems.length === 0);
      return { result, next: clean ? "ok" : "Fix the listed problems, then call epic_check again." };
    }),
);

await server.connect(new StdioServerTransport());
