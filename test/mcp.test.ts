import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, expect, test } from "vitest";
import { RemoteFixture } from "./fixtures";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

beforeAll(() => {
  execFileSync("npm", ["run", "build:mcp"], { cwd: repoRoot, stdio: "ignore" });
}, 60000);

type TextResult = { content: Array<{ text: string }>; isError?: boolean };

test("mcp server lists tools and answers epic_check", async () => {
  const fx = new RemoteFixture();
  await fx.setup();
  await fx.planAndPush();
  const client = new Client({ name: "t", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root], cwd: repoRoot }),
  );
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["epic_check", "epic_close", "epic_close_check", "epic_next", "epic_start", "epic_status"]);

    const check = (await client.callTool({ name: "epic_check", arguments: { epic: "E99" } })) as TextResult;
    expect(check.content[0].text).toContain("ok");
    expect(check.content[0].text.endsWith("\n\nok")).toBe(true);

    const status = (await client.callTool({ name: "epic_status", arguments: {} })) as TextResult;
    expect(status.isError).toBeFalsy();
    expect(JSON.parse(status.content[0].text.split("\n\n")[0]).epic).toBe("E99");

    const refused = (await client.callTool({ name: "epic_start", arguments: { story: "TH-902" } })) as TextResult;
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("written for TH-901, not TH-902");
  } finally {
    await client.close();
    fx.teardown();
  }
});
