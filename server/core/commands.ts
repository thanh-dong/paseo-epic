import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkPackage, counts, epicBranch, expectedNext, renderStatus, rowOf } from "./check";
import type { EpicConfig } from "./config";
import { ghAvailable, ghOpenPrs, gitDirty, localBranchExists, remoteBranchExists, run, runRaw } from "./git";
import { epicsDir, findEpicDir, hasMarkers, loadFromRef, loadLocal, packetSlug, subdirs } from "./locate";
import { slugify, today } from "./slug";
import { templateText } from "./templates";
import { EPIC_ID_RE, EpicError, type Row, STORY_ID_RE } from "./types";

const DIRTY = "working tree has uncommitted changes; commit or stash them first";

export interface StartResult {
  epic: string;
  epicBranch: string;
  behind: string;
  story: string;
  title: string;
  lane: string;
  storyBranch: string;
  action: "created" | "resumed" | "dry-run";
  handoff: string;
  warnings: string[];
}

export interface CheckResult {
  dir: string;
  problems: string[];
  summary: string;
}

/** Create the epic package from the templates, on its own `epic/<folder>` branch unless `noGit`. */
export async function cmdInit(
  root: string,
  config: EpicConfig,
  epicId: string,
  title: string,
  opts: { fromRef?: string; noGit?: boolean } = {},
): Promise<{ dir: string; branch: string }> {
  if (!EPIC_ID_RE.test(epicId)) throw new EpicError(`\`${epicId}\` is not an epic id like E20`);
  const base = epicsDir(root, config);
  mkdirSync(base, { recursive: true });
  const existing = subdirs(base).filter((d) => basename(d).split("-")[0] === epicId);
  const d = existing[0] ?? join(base, `${epicId}-${slugify(title)}`);
  const epicFile = join(d, "EPIC.md");
  if (existsSync(epicFile)) throw new EpicError(`${epicFile} already exists`);
  const name = basename(d);
  const branch = `epic/${name}`;
  if (!opts.noGit) {
    if (await gitDirty(root)) throw new EpicError(DIRTY);
    await run(["git", "fetch", "origin", "--prune"], root);
    if (await localBranchExists(root, branch)) {
      await run(["git", "checkout", branch], root);
    } else if (await remoteBranchExists(root, branch)) {
      await run(["git", "checkout", "-b", branch, `origin/${branch}`], root);
    } else {
      await run(["git", "checkout", "-b", branch, opts.fromRef ?? `origin/${config.baseBranch}`], root);
    }
  }
  mkdirSync(d, { recursive: true });
  // Function replacements, so `$` in the title is written as typed.
  const epicText = templateText(root, config, "epic.md")
    .replaceAll("ENN-slug", () => name)
    .replaceAll("# ENN — Epic title", () => `# ${epicId} — ${title}`)
    .replaceAll("ENN", () => epicId);
  const handoffText = templateText(root, config, "handoff.md")
    .replaceAll("ENN-slug", () => name)
    .replaceAll("ENN — Epic title", () => `${epicId} — ${title}`)
    .replaceAll("ENN", () => epicId)
    .replaceAll("written=YYYY-MM-DD", () => `written=${today()}`);
  writeFileSync(epicFile, epicText);
  writeFileSync(join(d, "HANDOFF.md"), handoffText);
  return { dir: d, branch };
}

/**
 * Cut (or resume) the next story's branch from the epic branch's remote tip.
 * The handoff is read from that tip, never from the working copy.
 */
export async function cmdStart(
  root: string,
  config: EpicConfig,
  ref: string,
  opts: { dryRun?: boolean; noGh?: boolean } = {},
): Promise<StartResult> {
  if (!ref) throw new EpicError("start needs an epic id (E20) or a story id (TH-652)");
  const d = findEpicDir(root, config, ref);
  const branch = existsSync(join(d, "EPIC.md")) ? epicBranch(loadLocal(d).epic) : `epic/${basename(d)}`;

  if (!opts.dryRun && (await gitDirty(root))) throw new EpicError(DIRTY);
  await run(["git", "fetch", "origin", "--prune"], root);
  if (!(await remoteBranchExists(root, branch))) {
    throw new EpicError(`origin/${branch} does not exist; push the epic branch first`);
  }

  const { epic, handoff } = await loadFromRef(root, d, `origin/${branch}`);
  const problems = checkPackage(epic, handoff);
  if (problems.length > 0) {
    throw new EpicError(`the package on origin/${branch} does not pass check:\n  - ${problems.join("\n  - ")}`);
  }
  const story = expectedNext(epic);
  if (story === "none") throw new EpicError(`${epic.id} has no open story (State ${epic.status.State})`);
  if (STORY_ID_RE.test(ref) && ref !== story) {
    throw new EpicError(
      `the handoff on origin/${branch} was written for ${story}, not ${ref}; close ${story} first or fix the story list`,
    );
  }
  if (handoff === null || handoff.next !== story) {
    throw new EpicError(`HANDOFF.md next=${handoff?.next} but the next open story is ${story}`);
  }

  const warnings: string[] = [];
  if (opts.noGh || !(await ghAvailable())) {
    warnings.push("gh not used; open PRs against the epic branch were NOT checked");
  } else {
    const prs = await ghOpenPrs(root, branch);
    if (prs.length > 0) {
      const listing = prs.map((p) => `#${p.number} ${p.headRefName}`).join(", ");
      throw new EpicError(`open PR(s) still target ${branch}: ${listing}. Merge first; one story in flight.`);
    }
  }

  const behind = (
    await run(["git", "rev-list", "--count", `origin/${branch}..origin/${config.baseBranch}`], root, false)
  ).trim();
  // expectedNext() returned an id from the story list, so the row exists.
  const row = rowOf(epic, story) as Row;
  const slug = (await packetSlug(root, d, branch, story)) ?? slugify(row.title);
  const storyBranch = `${config.branchPrefix}${story}-${slug}`;

  let action: StartResult["action"];
  if (opts.dryRun) {
    action = "dry-run";
  } else if (await localBranchExists(root, storyBranch)) {
    await run(["git", "checkout", storyBranch], root);
    const r = await runRaw(["git", "merge-base", "--is-ancestor", `origin/${branch}`, "HEAD"], root);
    if (r.code !== 0) {
      warnings.push(`${storyBranch} does not contain origin/${branch}; merge it in before continuing`);
    }
    action = "resumed";
  } else {
    await run(["git", "checkout", "-b", storyBranch, `origin/${branch}`], root);
    action = "created";
  }
  return {
    epic: epic.id,
    epicBranch: branch,
    behind: behind || "?",
    story,
    title: row.title,
    lane: row.lane,
    storyBranch,
    action,
    handoff: handoff.text.trimEnd(),
    warnings,
  };
}

/** Check one package (`ref`) or every package with status markers; problems are returned, not thrown. */
export async function cmdCheck(root: string, config: EpicConfig, ref?: string): Promise<CheckResult[]> {
  const dirs = ref ? [findEpicDir(root, config, ref)] : subdirs(epicsDir(root, config)).filter(hasMarkers);
  return dirs.map((d) => {
    const { epic, handoff } = loadLocal(d);
    const problems = checkPackage(epic, handoff);
    const name = basename(d);
    let summary: string;
    if (problems.length > 0) {
      summary = `${name}: ${problems.length} problem(s)`;
    } else {
      const [done, total] = counts(epic);
      summary = `${name}: ok — ${epic.status.State}, ${done} of ${total}, next ${expectedNext(epic)}`;
    }
    return { dir: d, problems, summary };
  });
}

/** Rewrite the Status block from the story table. */
export async function cmdRender(root: string, config: EpicConfig, ref: string): Promise<{ changed: boolean }> {
  const { epic } = loadLocal(findEpicDir(root, config, ref));
  const text = renderStatus(epic);
  const changed = text !== epic.text;
  if (changed) writeFileSync(epic.path, text);
  return { changed };
}
