import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "vitest";
import { type CloseResult, cmdCheck, cmdClose, cmdInit, cmdRender, cmdStart } from "../server/core/commands";
import { loadConfig } from "../server/core/config";
import { currentBranch } from "../server/core/git";
import { today } from "../server/core/slug";

const execFileP = promisify(execFile);

// Every git call in the test process, including the ones the commands make,
// ignores the machine's system git config.
process.env.GIT_CONFIG_NOSYSTEM ??= "1";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));

export const TODAY = today();

export const ROWS = `| TH-901 First thing | Builds the first thing. | normal | implemented | 2026-09-06 PR #1 |
| TH-902 Second thing | Builds the second thing. | normal | planned | |
| TH-903 Third thing | Builds the third thing. | high-risk | planned | |`;

export const ROW_901_PLANNED = "| TH-901 First thing | Builds the first thing. | normal | planned | |";
export const ROW_901_DONE =
  "| TH-901 First thing | Builds the first thing. | normal | implemented | 2026-09-06 PR #1 |";

export const LEDGER_901 = `
### TH-901 — 2026-09-06

- Branch / PR: \`feat/TH-901-first-thing\`, PR #1 into \`epic/E99-test-epic\`.
- Shipped: \`apps/server/src/one.ts\` (new).
- Decisions: none.
- Deviations: none.
- Effects on later stories: none.
`;

/** A fake repo root with the plugin's templates copied in. */
export function makeRoot(tmp: string): string {
  mkdirSync(join(tmp, "docs", "templates"), { recursive: true });
  for (const name of ["epic.md", "handoff.md"]) {
    cpSync(join(TEMPLATES, name), join(tmp, "docs", "templates", name));
  }
  mkdirSync(join(tmp, "docs", "stories", "epics"), { recursive: true });
  return tmp;
}

/** Write the E99 package with the real `init`, without git. Returns the package dir. */
export async function initE99(root: string): Promise<string> {
  const { dir } = await cmdInit(root, loadConfig(root), "E99", "Test epic", { noGit: true });
  return dir;
}

/** Init E99, put rows/ledger/handoff in, render the status. */
export async function fill(
  root: string,
  opts: { rows?: string; ledger?: string; after?: string; next?: string } = {},
): Promise<string> {
  const { rows = ROWS, ledger = LEDGER_901, after = "TH-901", next = "TH-902" } = opts;
  const d = await initE99(root);
  const f = join(d, "EPIC.md");
  const text = readFileSync(f, "utf8")
    .replaceAll(
      "| TH-NNN Story title | What it builds, in one or two sentences. | normal | planned | |",
      rows,
    )
    .replaceAll("## Dependencies", `${ledger}\n## Dependencies`);
  writeFileSync(f, text);
  await cmdRender(root, loadConfig(root), "E99");
  const h = join(d, "HANDOFF.md");
  writeFileSync(
    h,
    readFileSync(h, "utf8").replaceAll(
      `after=none next=none written=${TODAY}`,
      `after=${after} next=${next} written=${TODAY}`,
    ),
  );
  return d;
}

/** Run git with no system config and no commit signing; returns stdout. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  return stdout;
}

/** A clone of a local bare remote with the templates committed and pushed on main. */
export class RemoteFixture {
  tmp = "";
  remote = "";
  root = "";

  async setup(): Promise<void> {
    this.tmp = mkdtempSync(join(tmpdir(), "paseo-epic-git-"));
    this.remote = join(this.tmp, "remote.git");
    await git(this.tmp, "init", "--bare", "-q", "-b", "main", this.remote);
    this.root = join(this.tmp, "clone");
    await git(this.tmp, "clone", "-q", this.remote, this.root);
    await git(this.root, "config", "user.email", "t@example.com");
    await git(this.root, "config", "user.name", "Test");
    makeRoot(this.root);
    await git(this.root, "add", "-A");
    await git(this.root, "commit", "-q", "-m", "templates");
    await git(this.root, "push", "-q", "-u", "origin", "main");
  }

  teardown(): void {
    rmSync(this.tmp, { recursive: true, force: true });
  }

  /** Init E99 on its epic branch, plan three stories, check, commit and push. Returns the package dir. */
  async planAndPush(): Promise<string> {
    const cfg = loadConfig(this.root);
    const { dir } = await cmdInit(this.root, cfg, "E99", "Test epic", { fromRef: "origin/main" });
    expect(await currentBranch(this.root)).toBe("epic/E99-test-epic");
    const f = join(dir, "EPIC.md");
    const rows = ROWS.replace("| implemented | 2026-09-06 PR #1 |", "| planned | |");
    writeFileSync(
      f,
      readFileSync(f, "utf8").replace(
        "| TH-NNN Story title | What it builds, in one or two sentences. | normal | planned | |",
        rows,
      ),
    );
    await cmdRender(this.root, cfg, "E99");
    const h = join(dir, "HANDOFF.md");
    writeFileSync(h, readFileSync(h, "utf8").replace("next=none", "next=TH-901"));
    const [result] = await cmdCheck(this.root, cfg, "E99");
    expect(result.problems).toEqual([]);
    await git(this.root, "add", "-A");
    await git(this.root, "commit", "-q", "-m", "plan E99");
    await git(this.root, "push", "-q", "-u", "origin", "epic/E99-test-epic");
    return dir;
  }

  /** The agent's side of TH-901: implemented row, ledger entry, handoff for TH-902. */
  mark901Done(dir: string): void {
    const f = join(dir, "EPIC.md");
    writeFileSync(
      f,
      readFileSync(f, "utf8")
        .replace(ROW_901_PLANNED, ROW_901_DONE)
        .replace("## Dependencies", `${LEDGER_901}\n## Dependencies`),
    );
    const h = join(dir, "HANDOFF.md");
    writeFileSync(h, readFileSync(h, "utf8").replace("after=none next=TH-901", "after=TH-901 next=TH-902"));
  }

  /** Start TH-901, commit story work, update the package, close with noPr. */
  async close901(dir: string): Promise<CloseResult> {
    const cfg = loadConfig(this.root);
    await cmdStart(this.root, cfg, "TH-901", { noGh: true });
    writeFileSync(join(this.root, "one.ts"), "export const one = 1\n");
    await git(this.root, "add", "-A");
    await git(this.root, "commit", "-q", "-m", "feat(TH-901): one");
    this.mark901Done(dir);
    return cmdClose(this.root, cfg, "TH-901", { noPr: true, noGh: true });
  }
}
