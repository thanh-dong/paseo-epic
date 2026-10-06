import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { wantsEpicTools } from "./server/core/locate";
import { injectEpicMcp } from "./server/hooks/inject-mcp";
import { registerSpawnOnNext } from "./server/hooks/spawn-on-next";
import { MCP_BUNDLE } from "./server/mcp/bundle.generated";
import { registerHandlers, spawnNextFor } from "./server/rpc/handlers";

/** The git top level of `cwd`, or `cwd` itself when git cannot tell. */
function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
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

/**
 * The MCP server as a file a real node can run. The daemon loads this module
 * from a bundle with no plugin directory, so the script ships inside the
 * bundle as a string and is written once to the temp dir, named by its hash.
 */
export function materializeMcpBundle(): string {
  const hash = createHash("sha256").update(MCP_BUNDLE).digest("hex").slice(0, 12);
  const dir = join(tmpdir(), "paseo-epic");
  const file = join(dir, `epic-mcp-${hash}.mjs`);
  const size = Buffer.byteLength(MCP_BUNDLE);
  if (existsSync(file) && statSync(file).size === size) return file;
  mkdirSync(dir, { recursive: true });
  // Write then rename, so a second daemon never runs a half-written file.
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, MCP_BUNDLE);
  renameSync(partial, file);
  return file;
}

export default function contribute(server: PluginServerContext) {
  const mcpPath = materializeMcpBundle();
  const node = resolveNodePath();
  const removeHook = server.before("agent.create", ({ request }) =>
    injectEpicMcp(request, {
      mcpPath,
      nodePath: node.command,
      nodeEnv: node.env,
      // Any throw (a bad `.epic.yml`, an unreadable epics folder) is caught and logged by `injectEpicMcp`.
      isEpicRepo: wantsEpicTools,
      repoRoot,
    }),
  );
  const removeSpawnHook = registerSpawnOnNext(server, { spawnNextFor, repoRoot });
  registerHandlers(server, { spawnNextFor });
  return () => {
    removeHook();
    removeSpawnHook();
  };
}
