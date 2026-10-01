import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { resolveNodePath } from "../index.server";
import { loadConfig } from "../server/core/config";
import { isEpicRepo } from "../server/core/locate";
import { STATUS_BEGIN, STATUS_END } from "../server/core/types";
import { buildMcpConfig, injectEpicMcp } from "../server/hooks/inject-mcp";

const opts = {
  mcpPath: "/p/mcp/epic-mcp.mjs",
  nodePath: "/usr/bin/node",
  isEpicRepo: () => true,
  repoRoot: () => "/wt",
};

const epicServer = {
  type: "stdio",
  command: "/usr/bin/node",
  args: ["/p/mcp/epic-mcp.mjs", "/wt"],
  alwaysLoad: true,
};

test("injects for an epic repo and its worktree", () => {
  const out = injectEpicMcp({ config: { provider: "claude", cwd: "/wt" } }, opts);
  expect(out?.config.mcpServers?.epic).toEqual(epicServer);
});

test("passes the repo root of the agent cwd to the detector and the server", () => {
  const seen: string[] = [];
  const out = injectEpicMcp(
    { config: { provider: "claude", cwd: "/wt/apps/server" } },
    {
      ...opts,
      repoRoot: (cwd) => (cwd.startsWith("/wt") ? "/wt" : cwd),
      isEpicRepo: (root) => {
        seen.push(root);
        return true;
      },
    },
  );
  expect(seen).toEqual(["/wt"]);
  expect(out?.config.mcpServers?.epic).toEqual(epicServer);
  expect(out?.config.cwd).toBe("/wt/apps/server");
});

test("keeps existing servers", () => {
  const other = { type: "stdio" as const, command: "other-mcp" };
  const out = injectEpicMcp(
    { config: { provider: "claude", cwd: "/wt", mcpServers: { other } }, env: { A: "1" } },
    opts,
  );
  expect(out?.config.mcpServers).toEqual({ other, epic: epicServer });
  expect(out?.env).toEqual({ A: "1" });
});

test("does not inject for a non-epic repo", () => {
  const req = { config: { provider: "claude", cwd: "/elsewhere" } };
  expect(injectEpicMcp(req, { ...opts, isEpicRepo: () => false })).toBeUndefined();
});

test("isEpicRepo needs the status markers", () => {
  const root = mkdtempSync(join(tmpdir(), "paseo-epic-hook-"));
  try {
    const dir = join(root, "docs", "stories", "epics", "E1-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EPIC.md"), "# E1 — X\n\nNo status block here.\n");
    expect(isEpicRepo(root, loadConfig(root))).toBe(false);
    writeFileSync(join(dir, "EPIC.md"), `# E1 — X\n\n${STATUS_BEGIN}\nState: planned\n${STATUS_END}\n`);
    expect(isEpicRepo(root, loadConfig(root))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildMcpConfig puts env on the stdio config only when given", () => {
  expect(buildMcpConfig("/p/m.mjs", "/wt", "/app/Paseo Helper", { ELECTRON_RUN_AS_NODE: "1" })).toEqual({
    type: "stdio",
    command: "/app/Paseo Helper",
    args: ["/p/m.mjs", "/wt"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    alwaysLoad: true,
  });
  expect(buildMcpConfig("/p/m.mjs", "/wt", "/usr/bin/node")).not.toHaveProperty("env");
});

test("injectEpicMcp passes the node env through", () => {
  const out = injectEpicMcp(
    { config: { provider: "claude", cwd: "/wt" } },
    { ...opts, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } },
  );
  expect(out?.config.mcpServers?.epic).toEqual({ ...epicServer, env: { ELECTRON_RUN_AS_NODE: "1" } });
});

const savedNode = process.env.PASEO_EPIC_NODE;
afterEach(() => {
  if (savedNode === undefined) delete process.env.PASEO_EPIC_NODE;
  else process.env.PASEO_EPIC_NODE = savedNode;
});

test("resolveNodePath prefers PASEO_EPIC_NODE", () => {
  process.env.PASEO_EPIC_NODE = "/opt/node22/bin/node";
  expect(resolveNodePath()).toEqual({ command: "/opt/node22/bin/node" });
});

test("a throwing detection leaves the request alone and is logged once", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const failing = {
      ...opts,
      isEpicRepo: (): boolean => {
        throw new Error("EACCES: permission denied, scandir '/wt/docs/stories/epics'");
      },
    };
    const req = { config: { provider: "claude", cwd: "/wt" } };
    expect(injectEpicMcp(req, failing)).toBeUndefined();
    expect(injectEpicMcp(req, failing)).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("EACCES");
  } finally {
    log.mockRestore();
  }
});

test("a throwing repoRoot leaves the request alone", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const failing = {
      ...opts,
      repoRoot: (): string => {
        throw new Error("spawnSync git ETIMEDOUT");
      },
    };
    expect(injectEpicMcp({ config: { provider: "claude", cwd: "/slow" } }, failing)).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});
