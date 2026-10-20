import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { type EpicConfig, hasConfigFile, loadConfig } from "./config";
import { run, runRaw } from "./git";
import { folderEpicId, parseEpic, parseHandoff, rowOf, splitLines, storyOfName } from "./parse";
import { type EpicPackage, EpicError, type Handoff, STATUS_BEGIN } from "./types";

export function epicsDir(root: string, config: EpicConfig): string {
  return join(root, config.epicsDir);
}

/** The epic branch of the package in `dir`: `<epicBranchPrefix><folder>`. */
export function epicBranch(config: EpicConfig, dir: string): string {
  return `${config.epicBranchPrefix}${basename(dir)}`;
}

/** Folder names for a refusal. */
function names(dirs: string[]): string {
  return dirs.map((d) => basename(d)).join(", ");
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

/**
 * Should a new agent in this repo get the `epic` MCP server? Yes when the
 * repo has `.epic.yml` (an epic can be started with `epic_init`) or already
 * has an epic package. `loadConfig` runs first, so a broken `.epic.yml`
 * throws here and the create hook skips the agent.
 */
export function wantsEpicTools(root: string): boolean {
  const config = loadConfig(root);
  return hasConfigFile(root) || isEpicRepo(root, config);
}

export function hasMarkers(dir: string): boolean {
  const f = join(dir, "EPIC.md");
  return existsSync(f) && readFileSync(f, "utf8").includes(STATUS_BEGIN);
}

/**
 * `ref` is opaque: the package whose folder name before the first `-` is
 * `ref`; else the package whose story list has a row `ref`; else the folder
 * named `ref`.
 */
export function findEpicDir(root: string, config: EpicConfig, ref: string): string {
  const base = epicsDir(root, config);
  const dirs = subdirs(base);
  const byId = dirs.filter((d) => folderEpicId(d) === ref);
  if (byId.length > 1) throw new EpicError(`more than one folder for ${ref}: ${names(byId)}`);
  if (byId.length === 1) return byId[0];
  const byRow = dirs.filter((d) => {
    const f = join(d, "EPIC.md");
    return existsSync(f) && rowOf(parseEpic(f, readFileSync(f, "utf8")), ref) !== undefined;
  });
  if (byRow.length > 1) throw new EpicError(`${ref} is listed in more than one epic: ${names(byRow)}`);
  if (byRow.length === 1) return byRow[0];
  if (/[/\\]|\.\./.test(ref)) {
    throw new EpicError(
      `\`${ref}\` is not an epic id or a story in a story list, and a folder name cannot hold \`/\`, \`\\\` or \`..\``,
    );
  }
  const d = join(base, ref);
  if (existsSync(d) && statSync(d).isDirectory()) return d;
  throw new EpicError(`\`${ref}\` is not an epic id, a story in a story list, or a folder under ${base}`);
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

/**
 * The slug of the story's packet folder (`<story>-<slug>`) on origin/<branch>,
 * if one exists. `ids` are the package's story ids: a folder `S-1-x` belongs
 * to S-1, not to S.
 */
export async function packetSlug(
  root: string,
  dir: string,
  branch: string,
  story: string,
  ids: readonly string[],
): Promise<string | null> {
  const rel = gitRel(root, dir);
  const out = await run(["git", "ls-tree", "--name-only", `origin/${branch}`, `${rel}/`], root, false);
  for (const line of splitLines(out)) {
    const name = line.split("/").pop() ?? "";
    if (storyOfName([...ids, story], "", name) === story) return name.slice(story.length + 1);
  }
  return null;
}
