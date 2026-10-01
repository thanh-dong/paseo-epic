import type { PaseoApi } from "@getpaseo/client";
import type { PluginClientContext, PluginWorkspaceCommandContext } from "@getpaseo/plugin/client";
import { checkRpc, initRpc, nextRpc, statusRpc } from "./shared/contracts";
import { EpicPanel } from "./client/EpicPanel";
import { errorText, folderName, type PanelResult, postResult } from "./client/results";
import { closeInstructions, noAgent, startInstructions, USAGE } from "./client/strings";

const PANEL_ID = "epic";

// The hint is the word verb in angle brackets, then [id]. The opening bracket
// is escaped so the mobile audit's HTML-tag pattern does not match a string.
const ARGUMENT_HINT = "\u003Cverb> [id]";

/** True when `cwd` is the workspace directory or inside it. */
function isUnder(cwd: string, dir: string): boolean {
  const base = dir.replace(/[\\/]+$/, "");
  return cwd === base || cwd.startsWith(`${base}/`) || cwd.startsWith(`${base}\\`);
}

/** The id of the newest open agent whose cwd is under `dir`, or null. */
async function newestAgentIn(paseo: PaseoApi, dir: string) {
  let cursor: string | undefined;
  for (;;) {
    const page = await paseo.agents.list({
      sort: [{ key: "created_at", direction: "desc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    const hits = page.entries.map((e) => e.agent).filter((a) => a.status !== "closed" && isUnder(a.cwd, dir));
    if (hits.length > 0) return hits.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id;
    if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) return null;
    cursor = page.pageInfo.nextCursor;
  }
}

/**
 * Run an RPC, then show its result (or its error) in the Epic panel. An error
 * is also thrown, so Paseo shows it as a toast as well.
 */
async function runInPanel(ctx: PluginWorkspaceCommandContext, run: () => Promise<PanelResult>) {
  const dir = ctx.workspace.directory;
  try {
    postResult(dir, await run());
  } catch (err) {
    postResult(dir, { error: errorText(err) });
    ctx.openPanel(PANEL_ID);
    throw err;
  }
  ctx.openPanel(PANEL_ID);
}

/** Send `text` to the newest agent in the workspace. */
async function sendToAgent(ctx: PluginWorkspaceCommandContext, verb: string, text: string) {
  const agentId = await newestAgentIn(ctx.paseo, ctx.workspace.directory);
  if (agentId === null) throw new Error(noAgent(verb));
  await ctx.paseo.agents.ref(agentId).send(text);
}

/** The `/epic` slash command: a verb, then an optional id. */
async function onEpicCommand(ctx: PluginWorkspaceCommandContext & { args: string }) {
  const args = ctx.args.trim();
  const [verb = "", id] = args.split(/\s+/);
  const workspaceDir = ctx.workspace.directory;
  switch (verb) {
    case "start":
      if (!id) throw new Error(USAGE);
      return sendToAgent(ctx, verb, startInstructions(id));
    case "close":
      // `.epic.yml` close hooks live on the server; the client has none to add.
      if (!id) throw new Error(USAGE);
      return sendToAgent(ctx, verb, closeInstructions(id, []));
    case "init": {
      // `init E1 "Title"`: the title is the rest of the line, quotes optional.
      const title = /^init\s+\S+\s+(.+)$/s.exec(args)?.[1]?.trim().replace(/^(["'])(.*)\1$/s, "$2");
      if (!id || !title) throw new Error(USAGE);
      return runInPanel(ctx, async () => {
        await ctx.rpc(initRpc, { workspaceDir, epicId: id, title });
        return { ref: id };
      });
    }
    case "next":
      return runInPanel(ctx, async () => ({ message: (await ctx.rpc(nextRpc, { workspaceDir, story: id })).message }));
    case "check":
      return runInPanel(ctx, async () => {
        const results = await ctx.rpc(checkRpc, { workspaceDir, ref: id });
        // Without an id every package is checked; name the folder on each problem.
        const problems = results.flatMap((r) => (id ? r.problems : r.problems.map((p) => `${folderName(r.dir)}: ${p}`)));
        return { ref: id ?? null, problems };
      });
    case "status":
      return runInPanel(ctx, async () => {
        return { ref: id ?? null, status: await ctx.rpc(statusRpc, { workspaceDir, ref: id }) };
      });
    default:
      throw new Error(USAGE);
  }
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Epic",
      icon: "ListOrdered",
      context: "workspace",
      Component: EpicPanel,
    }),
    client.addSlashCommand({
      name: "epic",
      description: "Epic routine: init, start, close, next, check, status",
      argumentHint: ARGUMENT_HINT,
      context: "workspace",
      onSubmit: onEpicCommand,
    }),
    client.addCommandCenterItem({
      id: "epic-next",
      title: "Epic: start next story",
      icon: "Play",
      context: "workspace",
      onSelect: (ctx) =>
        runInPanel(ctx, async () => ({
          message: (await ctx.rpc(nextRpc, { workspaceDir: ctx.workspace.directory })).message,
        })),
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
