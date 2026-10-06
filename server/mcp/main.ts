import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeProblems, cmdCheck, cmdClose, cmdInit, cmdNext, cmdStart, cmdStatus } from "../core/commands";
import { loadConfig } from "../core/config";
import { isEpicRepo } from "../core/locate";
import { afterClose, afterCloseCheck, afterInit, afterNext, afterStart, noEpicYet, pendingLine } from "../core/text";
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
 * Run a tool: an optional first line, the result as pretty JSON, a blank
 * line, then what to do now. A refusal comes back as an error result with
 * its message, never thrown.
 */
async function answer(fn: () => Promise<{ first?: string; result: unknown; next: string }>): Promise<ToolAnswer> {
  try {
    const { first, result, next } = await fn();
    const head = first ? `${first}\n` : "";
    return { content: [{ type: "text", text: `${head}${JSON.stringify(result, null, 2)}\n\n${next}` }] };
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
      const config = loadConfig(root);
      // No package yet is a normal state of a repo with `.epic.yml`, not a failure.
      if (!isEpicRepo(root, config)) {
        return { result: { epic: null, epicsDir: config.epicsDir }, next: noEpicYet(config.epicsDir) };
      }
      const result = await cmdStatus(root, config);
      let next: string;
      if (result.problems.length > 0) next = "The package has problems. Fix the listed problems, then call epic_check.";
      else if (result.next === "none" || result.next === "") next = `${result.epic} has no open story.`;
      else next = `The next open story is ${result.next}. To begin it, call epic_start with ${result.next}.`;
      return { result, next };
    }),
);

server.registerTool(
  "epic_init",
  {
    description:
      "Call to create a new epic: it checks out the epic branch from the base branch and writes EPIC.md and HANDOFF.md from the templates.",
    inputSchema: { epic: z.string(), title: z.string() },
  },
  ({ epic, title }) =>
    answer(async () => {
      const result = await cmdInit(root, loadConfig(root), epic, title);
      return { result, next: afterInit(result.branch) };
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
      const config = loadConfig(root);
      const problems = await closeProblems(root, config, id);
      // The `.epic.yml` close hooks follow the paragraph, one per line, ready or not.
      return { result: { problems }, next: [afterCloseCheck(problems), ...config.hooks.close].join("\n") };
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
      // The pending line comes first, on its own line: the turn-ended hook reads it there.
      const first = result.next === null ? undefined : pendingLine(result.next.story, result.closed.story);
      return { first, result, next: afterNext(result, "pending") };
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
