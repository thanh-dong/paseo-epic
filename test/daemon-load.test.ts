import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";
import { STATUS_BEGIN, STATUS_END } from "../server/core/types";

// Paseo loads index.server.ts the way this test does: esbuild bundles it as
// CommonJS with zod and @getpaseo/* external, the output is wrapped in a
// function taking `require`, and that function is run with globalThis.eval.
// In that mode import.meta is {} and there is no plugin directory to read from.

const repo = fileURLToPath(new URL("..", import.meta.url));
const nodeRequire = createRequire(join(repo, "package.json"));

type Hook = (input: { request: unknown }) => unknown;

async function loadLikeTheDaemon(): Promise<{ default: (server: unknown) => unknown }> {
  const out = await build({
    entryPoints: [join(repo, "index.server.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    external: ["zod", "@getpaseo/*"],
    logLevel: "silent",
    write: false,
  });
  const code = out.outputFiles[0].text;
  const wrapped = `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
  const factory = globalThis.eval(wrapped) as (req: (name: string) => unknown) => { default: (server: unknown) => unknown };
  return factory((name) => (name === "@getpaseo/plugin" ? { defineRpc: (x: unknown) => x } : nodeRequire(name)));
}

test("the server bundle loads and runs the way the daemon loads it", async () => {
  const mod = await loadLikeTheDaemon();
  const before = new Map<string, Hook>();
  const on: string[] = [];
  const handled: unknown[] = [];
  const server = {
    before: (name: string, fn: Hook) => {
      before.set(name, fn);
      return () => {};
    },
    on: (name: string) => {
      on.push(name);
      return () => {};
    },
    handle: (rpc: unknown) => void handled.push(rpc),
  };
  expect(() => mod.default(server)).not.toThrow();
  expect(on).toContain("agent.turn_ended");
  expect(handled.length).toBeGreaterThan(0);
  const hook = before.get("agent.create");
  expect(hook).toBeTypeOf("function");

  const root = realpathSync(mkdtempSync(join(tmpdir(), "paseo-epic-load-")));
  try {
    const dir = join(root, "docs", "stories", "epics", "E1-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EPIC.md"), `# E1 — X\n\n${STATUS_BEGIN}\nState: planned\n${STATUS_END}\n`);
    const out = (hook as Hook)({ request: { config: { provider: "claude", cwd: root } } }) as {
      config: { mcpServers: Record<string, { args: string[] }> };
    };
    const mcpFile = out.config.mcpServers.epic.args[0];
    expect(mcpFile.startsWith(tmpdir())).toBe(true);
    expect(existsSync(mcpFile)).toBe(true);
    expect(readFileSync(mcpFile, "utf8").startsWith("import { createRequire } from 'node:module';")).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
