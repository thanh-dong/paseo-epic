import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, expect, test } from "vitest";
import { afterInit, afterStart, noEpicYet, pendingLine } from "../server/core/text";
import { git, RemoteFixture, TEMPLATE_ROW } from "./fixtures";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: repoRoot, stdio: "ignore" });
}, 60000);

type TextResult = { content: Array<{ text: string }>; isError?: boolean };

test("mcp server lists the five flow tools and answers status and start", async () => {
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
      expect(tools).toEqual(["epic_close", "epic_init", "epic_next", "epic_start", "epic_status"]);

      const status = (await client.callTool({ name: "epic_status", arguments: {} })) as TextResult;
      expect(status.isError).toBeFalsy();
      const [json, next] = status.content[0].text.split("\n\n");
      expect(JSON.parse(json).epic).toBe("E99");
      expect(Object.keys(JSON.parse(json))).not.toContain("problems");
      expect(next).toBe("The next open story is TH-901. To begin it, call epic_start with TH-901.");

      const refused = (await client.callTool({ name: "epic_start", arguments: { story: "TH-902" } })) as TextResult;
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("written for TH-901, not TH-902");
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
      const out = (await client.callTool({ name: "epic_next", arguments: { story: "TH-901", provider: "claude-team" } })) as TextResult;
      expect(out.isError).toBeFalsy();
      const text = out.content[0].text;
      const [first, ...rest] = text.split("\n");
      expect(first).toBe(pendingLine("TH-902", "TH-901", "claude-team"));
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

test("epic_init quotes hooks.init; epic_start quotes hooks.start, then the close hooks", async () => {
  const fx = new RemoteFixture();
  try {
    await fx.setup();
    const yml = [
      "hooks:",
      "  init:",
      '    - "Mint the story ids with the repo script."',
      "  start:",
      '    - "Run the gate."',
      "  close:",
      '    - "Fill the ledger entry."',
      '    - "Run the repo check."',
      "",
    ].join("\n");
    // Untracked, so the tree stays clean for init and start.
    writeFileSync(join(fx.root, ".epic.yml"), yml);
    const client = new Client({ name: "t", version: "0" });
    // No gh: the remote is not on GitHub, so the open-PR guard would fail to list PRs.
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["mcp/epic-mcp.mjs", fx.root],
        cwd: repoRoot,
        env: gitOnlyEnv(fx.tmp),
      }),
    );
    try {
      const init = (await client.callTool({ name: "epic_init", arguments: { epic: "E7", title: "Search" } })) as TextResult;
      expect(init.isError).toBeFalsy();
      const initNext = init.content[0].text.split("\n\n").slice(1).join("\n\n");
      expect(initNext).toBe(afterInit("epic/E7-search", ["Mint the story ids with the repo script."]));
      expect(initNext.split("\n")[1]).toBe("Mint the story ids with the repo script.");

      // Plan and push E7 by hand: one row, the handoff names it.
      const dir = join(fx.root, "docs", "stories", "epics", "E7-search");
      const f = join(dir, "EPIC.md");
      writeFileSync(f, readFileSync(f, "utf8").replace(TEMPLATE_ROW, "| S-1 First | One. | normal | planned | |"));
      const h = join(dir, "HANDOFF.md");
      writeFileSync(h, readFileSync(h, "utf8").replace("next=none", "next=S-1"));
      await git(fx.root, "add", "docs");
      await git(fx.root, "commit", "-q", "-m", "plan E7");
      await git(fx.root, "push", "-q", "-u", "origin", "epic/E7-search");

      const start = (await client.callTool({ name: "epic_start", arguments: { story: "E7" } })) as TextResult;
      expect(start.isError).toBeFalsy();
      const startNext = start.content[0].text.split("\n\n").at(-1) ?? "";
      expect(startNext).toBe(afterStart("S-1", ["Run the gate."], ["Fill the ledger entry.", "Run the repo check."]));
      expect(startNext.split("\n").slice(1)).toEqual([
        "When the story is done:",
        "Fill the ledger entry.",
        "Run the repo check.",
        "Call epic_close with S-1.",
      ]);
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

      const badId = await init("E-1", "Search");
      expect(badId.isError).toBe(true);
      expect(badId.content[0].text).toContain("`E-1` cannot be an epic id");

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
      expect(next).toBe(afterInit("epic/E7-search", []));
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
