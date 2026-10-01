import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EpicError } from "./types";

const execFileP = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command without a shell and report its exit code instead of throwing. */
export async function runRaw(cmd: string[], cwd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd[0], cmd.slice(1), { cwd, maxBuffer: MAX_BUFFER });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      // A numeric code is the exit status of a process that ran; a string code
      // (e.g. ENOENT) means it never started, so stderr is empty and the reason is in message.
      stderr: typeof e.code === "number" ? (e.stderr ?? "") : e.stderr || e.message,
    };
  }
}

/** Run a command and return stdout; when `check`, a non-zero exit is an EpicError. */
export async function run(cmd: string[], cwd: string, check = true): Promise<string> {
  const r = await runRaw(cmd, cwd);
  if (check && r.code !== 0) {
    throw new EpicError(`\`${cmd.join(" ")}\` failed:\n${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout;
}

export async function gitDirty(root: string): Promise<string> {
  return (await run(["git", "status", "--porcelain", "--untracked-files=no"], root)).trim();
}

export async function currentBranch(root: string): Promise<string> {
  return (await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)).trim();
}

export async function remoteBranchExists(root: string, branch: string): Promise<boolean> {
  const r = await runRaw(["git", "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], root);
  return r.code === 0;
}

export async function localBranchExists(root: string, branch: string): Promise<boolean> {
  const r = await runRaw(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], root);
  return r.code === 0;
}

export async function ghAvailable(): Promise<boolean> {
  return (await runRaw(["gh", "--version"], process.cwd())).code === 0;
}

export async function ghOpenPrs(
  root: string,
  base: string,
  head?: string,
): Promise<Array<{ number: number; title: string; headRefName: string; url: string }>> {
  const cmd = ["gh", "pr", "list", "--base", base, "--state", "open", "--json", "number,title,headRefName,url"];
  if (head) cmd.push("--head", head);
  const out = await run(cmd, root);
  return JSON.parse(out || "[]");
}

export interface MergedPr {
  number: number;
  url: string;
  headRefName: string;
  mergedAt: string;
  title: string;
}

export async function ghMergedPrs(root: string, base: string): Promise<MergedPr[]> {
  const out = await run(
    [
      "gh", "pr", "list", "--base", base, "--state", "merged", "--limit", "100",
      "--json", "number,url,headRefName,mergedAt,title",
    ],
    root,
  );
  return JSON.parse(out || "[]");
}

export interface PrComment {
  author: string;
  /** GitHub's authorAssociation: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string;
  createdAt: string;
  body: string;
}

/** The conversation comments of PR `number`, author flattened to the login. */
export async function ghPrComments(root: string, number: number): Promise<PrComment[]> {
  const out = await run(["gh", "pr", "view", String(number), "--json", "comments"], root);
  const raw: Array<{ author?: { login?: string }; authorAssociation?: string; createdAt?: string; body?: string }> =
    JSON.parse(out || "{}").comments ?? [];
  return raw.map((c) => ({
    author: c.author?.login ?? "",
    association: c.authorAssociation ?? "",
    createdAt: c.createdAt ?? "",
    body: c.body ?? "",
  }));
}
