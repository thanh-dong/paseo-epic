import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, expect, test } from "vitest";
import { afterInit, noEpicYet, pendingLine } from "../server/core/text";
import { git, RemoteFixture } from "./fixtures";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: repoRoot, stdio: "ignore" });
}, 60000);

type TextResult = { content: Array<{ text: string }>; isError?: boolean };

test("mcp server lists tools and answers epic_check", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    await fx.planAndPush();
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root], cwd: repoRoot }),
    );
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual([
        "epic_check",
        "epic_close",
        "epic_close_check",
        "epic_init",
        "epic_next",
        "epic_start",
        "epic_status",
      ]);

      const check = (await client.callTool({ name: "epic_check", arguments: { epic: "E99" } })) as TextResult;
      expect(check.content[0].text).toContain("ok");
      expect(check.content[0].text.endsWith("\n\nok")).toBe(true);

      const status = (await client.callTool({ name: "epic_status", arguments: {} })) as TextResult;
      expect(status.isError).toBeFalsy();
      expect(JSON.parse(status.content[0].text.split("\n\n")[0]).epic).toBe("E99");

      const refused = (await client.callTool({ name: "epic_start", arguments: { story: "TH-902" } })) as TextResult;
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("written for TH-901, not TH-902");

      const closeCheck = (await client.callTool({
        name: "epic_close_check",
        arguments: { story: "TH-901" },
      })) as TextResult;
      expect(closeCheck.isError).toBeFalsy();
      const [json, next] = closeCheck.content[0].text.split("\n\n");
      const parsed = JSON.parse(json);
      expect(Object.keys(parsed)).toEqual(["problems"]);
      expect(parsed.problems).toContain("EPIC.md: TH-901 row is `planned`, expected `implemented`");
      expect(next).toContain("call epic_close_check again");
    } finally {
      await client.close();
    }
  } finally {
    fx.teardown();
  }
});

/** A PATH holding only git, so the server finds no `gh` and reads no PRs. */
function gitOnlyEnv(tmp: string): Record<string, string> {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
  return { HOME: process.env.HOME ?? tmp, PATH: bin, GIT_CONFIG_NOSYSTEM: "1" };
}

test("epic_next prints the pending line first, then the JSON and what to do", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    const dir = await fx.planAndPush();
    await fx.close901(dir);
    await git(fx.root, "push", "-q", "origin", "feat/TH-901-first-thing:epic/E99-test-epic");
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["mcp/epic-mcp.mjs", fx.root],
        cwd: repoRoot,
        env: gitOnlyEnv(fx.tmp),
      }),
    );
    try {
      const out = (await client.callTool({ name: "epic_next", arguments: { story: "TH-901" } })) as TextResult;
      expect(out.isError).toBeFalsy();
      const text = out.content[0].text;
      const [first, ...rest] = text.split("\n");
      expect(first).toBe(pendingLine("TH-902", "TH-901"));
      const [json, next] = rest.join("\n").split("\n\n");
      expect(JSON.parse(json).next.story).toBe("TH-902");
      expect(next).toContain("The plugin is starting the successor now");
    } finally {
      await client.close();
    }
  } finally {
    fx.teardown();
  }
});

test("epic_close_check quotes the .epic.yml close hooks, with problems and when ready", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    const dir = await fx.planAndPush();
    const hook = "Accept ADRs scoped inside the story.";
    writeFileSync(join(fx.root, ".epic.yml"), `hooks:\n  close:\n    - "${hook}"\n`);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root], cwd: repoRoot }),
    );
    try {
      const check = async () => {
        const out = (await client.callTool({ name: "epic_close_check", arguments: { story: "TH-901" } })) as TextResult;
        expect(out.isError).toBeFalsy();
        return out.content[0].text.split("\n\n").slice(1).join("\n\n").split("\n");
      };
      const withProblems = await check();
      expect(withProblems[0]).toContain("call epic_close_check again");
      expect(withProblems.at(-1)).toBe(hook);

      fx.mark901Done(dir);
      const ready = await check();
      expect(ready).toEqual(["The package is ready to close. Call epic_close now.", hook]);
    } finally {
      await client.close();
    }
  } finally {
    fx.teardown();
  }
});

test("epic_init creates the package and its branch, and keeps cmdInit's refusals", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root], cwd: repoRoot }),
    );
    try {
      const init = async (epic: string, title: string) =>
        (await client.callTool({ name: "epic_init", arguments: { epic, title } })) as TextResult;

      const badId = await init("X1", "Search");
      expect(badId.isError).toBe(true);
      expect(badId.content[0].text).toBe("`X1` is not an epic id like E20");

      // A tracked file with uncommitted changes: refused before any branch moves.
      const tracked = join(fx.root, "docs", "templates", "epic.md");
      appendFileSync(tracked, "\nlocal edit\n");
      const dirty = await init("E8", "Dirty");
      expect(dirty.isError).toBe(true);
      expect(dirty.content[0].text).toBe("working tree has uncommitted changes; commit or stash them first");
      expect((await git(fx.root, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("main");
      await git(fx.root, "checkout", "--", tracked);

      const created = await init("E7", "Search");
      expect(created.isError).toBeFalsy();
      const [json, next] = created.content[0].text.split("\n\n");
      const result = JSON.parse(json);
      const dir = join(fx.root, "docs", "stories", "epics", "E7-search");
      expect(result).toEqual({ dir, branch: "epic/E7-search" });
      expect(next).toBe(afterInit("epic/E7-search"));
      expect(existsSync(join(dir, "EPIC.md"))).toBe(true);
      expect(existsSync(join(dir, "HANDOFF.md"))).toBe(true);
      expect((await git(fx.root, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("epic/E7-search");

      const again = await init("E7", "Search");
      expect(again.isError).toBe(true);
      expect(again.content[0].text).toBe(`${join(dir, "EPIC.md")} already exists`);
    } finally {
      await client.close();
    }
  } finally {
    fx.teardown();
  }
});

test("epic_status on a repo with .epic.yml and no epic says to call epic_init", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    writeFileSync(join(fx.root, ".epic.yml"), "baseBranch: main\n");
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root], cwd: repoRoot }),
    );
    try {
      const out = (await client.callTool({ name: "epic_status", arguments: {} })) as TextResult;
      expect(out.isError).toBeFalsy();
      const [json, next] = out.content[0].text.split("\n\n");
      expect(JSON.parse(json)).toEqual({ epic: null, epicsDir: "docs/stories/epics" });
      expect(next).toBe(noEpicYet("docs/stories/epics"));
      expect(next).toContain("Call epic_init");
    } finally {
      await client.close();
    }
  } finally {
    fx.teardown();
  }
});
