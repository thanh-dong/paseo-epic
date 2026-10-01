import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { loadConfig } from "./server/core/config";
import { isEpicRepo } from "./server/core/locate";
import { injectEpicMcp } from "./server/hooks/inject-mcp";
import { registerHandlers, spawnNext } from "./server/rpc/handlers";

/** The git top level of `cwd`, or `cwd` itself when git cannot tell. */
function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return cwd;
  }
}

/**
 * The node that runs the MCP server. The daemon runs under the Paseo Helper
 * (Electron), so `process.execPath` is not plain node: prefer
 * `PASEO_EPIC_NODE`, then `node` on PATH, then Electron run as node.
 */
export function resolveNodePath(): { command: string; env?: Record<string, string> } {
  const configured = process.env.PASEO_EPIC_NODE;
  if (configured) return { command: configured };
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, ["node"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = out.split(/\r?\n/)[0].trim();
    if (found) return { command: found };
  } catch {
    // No node on PATH: fall through to Electron.
  }
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** Bad `.epic.yml` messages already logged, so each is logged once. */
const reported = new Set<string>();

/** Epic detection for the create hook; a repo with a bad `.epic.yml` is not an epic repo. */
function detectEpic(root: string): boolean {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(root);
  } catch (err) {
    const message = `paseo-epic: ${root}: ${(err as Error).message}`;
    if (!reported.has(message)) {
      reported.add(message);
      console.error(message);
    }
    return false;
  }
  return isEpicRepo(root, config);
}

export default function contribute(server: PluginServerContext) {
  const mcpPath = fileURLToPath(new URL("./mcp/epic-mcp.mjs", import.meta.url));
  const node = resolveNodePath();
  const removeHook = server.before("agent.create", ({ request }) =>
    injectEpicMcp(request, {
      mcpPath,
      nodePath: node.command,
      nodeEnv: node.env,
      isEpicRepo: detectEpic,
      repoRoot,
    }),
  );
  registerHandlers(server, { spawnNext });
  return () => {
    removeHook();
  };
}
