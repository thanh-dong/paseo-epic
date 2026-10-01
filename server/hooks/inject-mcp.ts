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

/**
 * The `before agent.create` transform: add the `epic` MCP server when the
 * agent's repo is in an epic. Returns `undefined` (leave the request as is)
 * otherwise.
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
  const root = opts.repoRoot(request.config.cwd);
  if (!opts.isEpicRepo(root)) return undefined;
  return {
    ...request,
    config: {
      ...request.config,
      mcpServers: { ...request.config.mcpServers, epic: buildMcpConfig(opts.mcpPath, root, opts.nodePath, opts.nodeEnv) },
    },
  };
}
