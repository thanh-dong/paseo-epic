// Types the plugin needs from Paseo, derived from the host-supplied
// `@getpaseo/plugin/server` SDK only. Paseo compiles the plugin after
// `npm ci --omit=dev`, so `@getpaseo/client` and `@getpaseo/protocol` are not
// installed there and must never be imported, not even as types.
import type { PluginBeforeRequests, PluginHandlerContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHandlerContext["paseo"];
export type AgentSessionConfig = PluginBeforeRequests["agent.create"]["config"];
type McpServerConfig = NonNullable<AgentSessionConfig["mcpServers"]>[string];
export type McpStdioServerConfig = Extract<McpServerConfig, { type: "stdio" }>;
export type AgentTimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];
