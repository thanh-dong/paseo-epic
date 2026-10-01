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
      // stderr is undefined only when the process never ran (e.g. ENOENT).
      stderr: e.stderr ?? e.message,
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
