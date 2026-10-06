import { currentBranch, remoteBranchExists, run } from "./git";
import { EpicError } from "./types";

export type ChangeStatus = "A" | "M" | "D" | "R";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  committed: boolean;
}

export interface StoryChanges {
  base: string;
  head: string;
  ahead: number;
  files: ChangedFile[];
}

/** Strip the quotes git puts around a path with special characters, and unescape `\"` and `\\`. */
function unquote(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path;
  return path.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

function lines(out: string): string[] {
  return out.split("\n").filter((l) => l.length > 0);
}

/** Parse `git diff --name-status`; every entry is committed. */
export function parseNameStatus(out: string): ChangedFile[] {
  return lines(out).map((line) => {
    const [code, ...paths] = line.split("\t");
    const path = unquote(paths[paths.length - 1]);
    const letter = code[0];
    let status: ChangeStatus = "M";
    if (letter === "R") status = "R";
    else if (letter === "A" || letter === "C") status = "A";
    else if (letter === "D") status = "D";
    return { path, status, committed: true };
  });
}

/** Parse `git status --porcelain`; every entry is uncommitted. */
export function parsePorcelain(out: string): ChangedFile[] {
  return lines(out).map((line) => {
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    let status: ChangeStatus = "M";
    if (xy === "??" || xy[0] === "A") status = "A";
    else if (xy === "D " || xy === " D") status = "D";
    else if (xy[0] === "R") {
      status = "R";
      rest = rest.slice(rest.lastIndexOf(" -> ") + 4);
    }
    return { path: unquote(rest), status, committed: false };
  });
}

/** The files a story worktree at `dir` changed against `origin/<epicBranch>`, committed or not. */
export async function storyChanges(dir: string, epicBranch: string): Promise<StoryChanges> {
  if (!(await remoteBranchExists(dir, epicBranch))) {
    throw new EpicError(`origin/${epicBranch} does not exist; push the epic branch first`);
  }
  const base = `origin/${epicBranch}`;
  const head = await currentBranch(dir);
  const ahead = Number((await run(["git", "rev-list", "--count", `${base}..HEAD`], dir)).trim());
  const committed = parseNameStatus(
    await run(["git", "-c", "core.quotePath=false", "diff", "--name-status", `${base}...HEAD`], dir),
  );
  const uncommitted = parsePorcelain(
    await run(["git", "-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"], dir),
  );

  const byPath = new Map(committed.map((f) => [f.path, f]));
  for (const f of uncommitted) {
    const prev = byPath.get(f.path);
    // A new or renamed file edited again is still new or renamed.
    const keep = prev && (prev.status === "A" || prev.status === "R") && f.status === "M";
    byPath.set(f.path, { path: f.path, status: keep ? prev.status : f.status, committed: false });
  }
  const files = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { base, head, ahead, files };
}
