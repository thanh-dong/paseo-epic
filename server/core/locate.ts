import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { EpicConfig } from "./config";
import { run, runRaw } from "./git";
import { parseEpic, parseHandoff, splitLines } from "./parse";
import { rowOf } from "./check";
import { EPIC_ID_RE, type EpicPackage, EpicError, type Handoff, STATUS_BEGIN, STORY_ID_RE } from "./types";

export function epicsDir(root: string, config: EpicConfig): string {
  return join(root, config.epicsDir);
}

/** Python's repr of a list of folder names, kept so refusals match epic.py. */
function pyList(dirs: string[]): string {
  return `[${dirs.map((d) => `'${basename(d)}'`).join(", ")}]`;
}

/** Sorted sub-folders of `base`; none when `base` does not exist. */
export function subdirs(base: string): string[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => join(base, name));
}

/** True when some package under `epicsDir` has an EPIC.md with the status markers. */
export function isEpicRepo(root: string, config: EpicConfig): boolean {
  return subdirs(epicsDir(root, config)).some((d) => hasMarkers(d));
}

export function hasMarkers(dir: string): boolean {
  const f = join(dir, "EPIC.md");
  return existsSync(f) && readFileSync(f, "utf8").includes(STATUS_BEGIN);
}

/** `ref` is an epic id (E20), a story id (TH-652), or a folder name. */
export function findEpicDir(root: string, config: EpicConfig, ref: string): string {
  const base = epicsDir(root, config);
  const dirs = subdirs(base);
  if (EPIC_ID_RE.test(ref)) {
    const hits = dirs.filter((d) => basename(d).split("-")[0] === ref);
    if (hits.length === 0) throw new EpicError(`no epic folder ${ref}-* under ${base}`);
    if (hits.length > 1) {
      throw new EpicError(`more than one folder for ${ref}: ${pyList(hits)}`);
    }
    return hits[0];
  }
  if (STORY_ID_RE.test(ref)) {
    const hits = dirs.filter((d) => {
      const f = join(d, "EPIC.md");
      return existsSync(f) && rowOf(parseEpic(f, readFileSync(f, "utf8")), ref) !== undefined;
    });
    if (hits.length === 0) throw new EpicError(`no EPIC.md story list contains ${ref}`);
    if (hits.length > 1) {
      throw new EpicError(`${ref} is listed in more than one epic: ${pyList(hits)}`);
    }
    return hits[0];
  }
  const d = join(base, ref);
  if (existsSync(d) && statSync(d).isDirectory()) return d;
  throw new EpicError(`\`${ref}\` is not an epic id, a story id, or a folder under ${base}`);
}

export function loadLocal(dir: string): { epic: EpicPackage; handoff: Handoff | null } {
  const f = join(dir, "EPIC.md");
  if (!existsSync(f)) throw new EpicError(`${f} missing (run \`init\`)`);
  const h = join(dir, "HANDOFF.md");
  return {
    epic: parseEpic(f, readFileSync(f, "utf8")),
    handoff: existsSync(h) ? parseHandoff(readFileSync(h, "utf8")) : null,
  };
}

/** `dir` relative to `root`, with `/` separators as git expects. */
export function gitRel(root: string, dir: string): string {
  return relative(root, dir).split(sep).join("/");
}

/** Read the package as committed on `ref` (e.g. `origin/epic/E20-x`), not the working copy. */
export async function loadFromRef(
  root: string,
  dir: string,
  ref: string,
): Promise<{ epic: EpicPackage; handoff: Handoff | null }> {
  const rel = gitRel(root, dir);
  const text = await run(["git", "show", `${ref}:${rel}/EPIC.md`], root, false);
  if (!text) throw new EpicError(`${rel}/EPIC.md does not exist on ${ref}`);
  const r = await runRaw(["git", "show", `${ref}:${rel}/HANDOFF.md`], root);
  return {
    epic: parseEpic(join(dir, "EPIC.md"), text),
    handoff: r.code === 0 ? parseHandoff(r.stdout) : null,
  };
}

/** The slug of the story's packet folder (`<story>-<slug>`) on origin/<branch>, if one exists. */
export async function packetSlug(root: string, dir: string, branch: string, story: string): Promise<string | null> {
  const rel = gitRel(root, dir);
  const out = await run(["git", "ls-tree", "--name-only", `origin/${branch}`, `${rel}/`], root, false);
  for (const line of splitLines(out)) {
    const name = line.split("/").pop() ?? "";
    if (name.startsWith(`${story}-`)) return name.slice(story.length + 1);
  }
  return null;
}
