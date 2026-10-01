import type { AgentSessionConfig, McpStdioServerConfig } from "@getpaseo/protocol/agent-types";

/**
 * The stdio `epic` MCP server: the bundled script run by node, given the repo
 * root. `env` is set when the node command needs it (Electron run as node).
 */
export function buildMcpConfig(
  mcpPath: string,
  repoRoot: string,
  nodePath: string,
  env?: Record<string, string>,
): McpStdioServerConfig {
  const config: McpStdioServerConfig = { type: "stdio", command: nodePath, args: [mcpPath, repoRoot], alwaysLoad: true };
  return env ? { ...config, env } : config;
}

/** Detection failures already logged, so each distinct message is logged once. */
const reported = new Set<string>();

function reportOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.error(message);
}

/**
 * The `before agent.create` transform: add the `epic` MCP server when the
 * agent's repo is in an epic. Returns `undefined` (leave the request as is)
 * otherwise, including when detection throws (logged once per message).
 */
export function injectEpicMcp(
  request: { config: AgentSessionConfig; env?: Record<string, string> },
  opts: {
    mcpPath: string;
    nodePath: string;
    nodeEnv?: Record<string, string>;
    isEpicRepo: (cwd: string) => boolean;
    repoRoot: (cwd: string) => string;
  },
): typeof request | undefined {
  let root: string;
  try {
    root = opts.repoRoot(request.config.cwd);
    if (!opts.isEpicRepo(root)) return undefined;
  } catch (err) {
    // The hook never throws into the daemon: a failed detection means "not an epic repo".
    reportOnce(`paseo-epic: epic detection failed for ${request.config.cwd}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  return {
    ...request,
    config: {
      ...request.config,
      mcpServers: { ...request.config.mcpServers, epic: buildMcpConfig(opts.mcpPath, root, opts.nodePath, opts.nodeEnv) },
    },
  };
}
