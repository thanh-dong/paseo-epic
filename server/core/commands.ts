import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { EpicConfig } from "./config";
import {
  currentBranch,
  ghAvailable,
  ghMergedPrs,
  ghOpenPrs,
  ghPrComments,
  gitDirty,
  localBranchExists,
  type MergedPr,
  type PrComment,
  remoteBranchExists,
  run,
  runRaw,
} from "./git";
import {
  epicBranch,
  epicsDir,
  findEpicDir,
  gitRel,
  hasMarkers,
  loadFromRef,
  loadLocal,
  packetSlug,
  subdirs,
} from "./locate";
import { folderEpicId, ledgerEntry, rowOf, splitLines, storyOfName } from "./parse";
import { slugify, today } from "./slug";
import { templateText } from "./templates";
import { type EpicPackage, EpicError, type Handoff, type Row } from "./types";

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

/**
 * The handoff header the flow reads (`next=`, `after=`), or a refusal that
 * names the file and where it was read.
 */
function requireHeader(handoff: Handoff | null, where: string): Handoff {
  if (handoff === null) throw new EpicError(`HANDOFF.md does not exist ${where}`);
  if (!handoff.found) {
    throw new EpicError(
      `HANDOFF.md ${where} has no handoff header \`<!-- handoff: epic=… after=… next=… written=… -->\``,
    );
  }
  return handoff;
}

/** The story ids of the package's rows. */
function storyIds(epic: EpicPackage): string[] {
  return epic.rows.map((r) => r.id);
}

/** The branch slug for `story`: its packet folder on origin/<branch>, else its row title, else the id. */
async function storySlug(root: string, dir: string, branch: string, story: string, epic: EpicPackage) {
  const fromPacket = await packetSlug(root, dir, branch, story, storyIds(epic));
  return fromPacket ?? slugify(rowOf(epic, story)?.title || story);
}

/** Create the epic package from the templates, on its own `<epicBranchPrefix><folder>` branch unless `noGit`. */
export async function cmdInit(
  root: string,
  config: EpicConfig,
  epicId: string,
  title: string,
  opts: { fromRef?: string; noGit?: boolean } = {},
): Promise<{ dir: string; branch: string }> {
  // The epic id is the folder name before its first `-`, so it can hold no `-` and no path parts.
  if (!epicId || /[-/\\\s]/.test(epicId)) {
    throw new EpicError(
      `\`${epicId}\` cannot be an epic id: the id is the package folder name before its first \`-\`, ` +
        "so it must be non-empty with no `-`, `/`, `\\` or spaces",
    );
  }
  const base = epicsDir(root, config);
  mkdirSync(base, { recursive: true });
  const existing = subdirs(base).filter((d) => folderEpicId(d) === epicId);
  const d = existing[0] ?? join(base, `${epicId}-${slugify(title)}`);
  const epicFile = join(d, "EPIC.md");
  if (existsSync(epicFile)) throw new EpicError(`${epicFile} already exists`);
  const name = basename(d);
  const branch = epicBranch(config, d);
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
    .replaceAll("epic/ENN-slug", () => branch)
    .replaceAll("ENN-slug", () => name)
    .replaceAll("# ENN — Epic title", () => `# ${epicId} — ${title}`)
    .replaceAll("ENN", () => epicId);
  const handoffText = templateText(root, config, "handoff.md")
    .replaceAll("epic/ENN-slug", () => branch)
    .replaceAll("ENN-slug", () => name)
    .replaceAll("ENN — Epic title", () => `${epicId} — ${title}`)
    .replaceAll("ENN", () => epicId)
    .replaceAll("written=YYYY-MM-DD", () => `written=${today()}`);
  writeFileSync(epicFile, epicText);
  writeFileSync(join(d, "HANDOFF.md"), handoffText);
  return { dir: d, branch };
}

/**
 * Cut (or resume) the branch of the story the handoff names (`next=`) from
 * the epic branch's remote tip. The handoff is read from that tip, never
 * from the working copy.
 */
export async function cmdStart(
  root: string,
  config: EpicConfig,
  ref: string,
  opts: { dryRun?: boolean; noGh?: boolean } = {},
): Promise<StartResult> {
  if (!ref) throw new EpicError("start needs an epic id or a story id");
  const d = findEpicDir(root, config, ref);
  const branch = epicBranch(config, d);

  if (!opts.dryRun && (await gitDirty(root))) throw new EpicError(DIRTY);
  await run(["git", "fetch", "origin", "--prune"], root);
  if (!(await remoteBranchExists(root, branch))) {
    throw new EpicError(`origin/${branch} does not exist; push the epic branch first`);
  }

  const { epic, handoff: tipHandoff } = await loadFromRef(root, d, `origin/${branch}`);
  const handoff = requireHeader(tipHandoff, `on origin/${branch}`);
  const story = handoff.next;
  if (story === "none") {
    throw new EpicError(`the handoff on origin/${branch} says next=none: ${epic.id} has no open story`);
  }
  // A ref that is not the epic id or the folder is a story.
  if (ref !== epic.id && ref !== basename(d) && ref !== story) {
    throw new EpicError(
      `the handoff on origin/${branch} was written for ${story}, not ${ref}; close ${story} first or fix the handoff`,
    );
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
  const row = rowOf(epic, story);
  const storyBranch = `${config.branchPrefix}${story}-${await storySlug(root, d, branch, story, epic)}`;

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
    title: row?.title ?? "",
    lane: row?.lane ?? "",
    storyBranch,
    action,
    handoff: handoff.text.trimEnd(),
    warnings,
  };
}

export interface CloseResult {
  committed: boolean;
  /** The commit subject, or why nothing was committed. */
  message: string;
  pushed: boolean;
  pr: { number: number; url: string } | null;
  epicPr: { url: string } | null;
  /** Commands a human must run because the plugin did not push or did not use gh. */
  manual: string[];
}

export interface NextResult {
  epic: string;
  epicBranch: string;
  closed: { story: string; pr: MergedPr | null; comments: PrComment[] };
  next: { story: string; title: string; lane: string; branch: string; baseRef: string } | null;
}

export interface StatusResult {
  epic: string;
  title: string;
  epicBranch: string;
  state: string;
  stories: string;
  next: string;
  behind: string | null;
  rows: Row[];
  openPr: { number: number; url: string; headRefName: string } | null;
  /** The `.epic.yml` close hooks, so the client's close prompt can quote them. */
  closeHooks: string[];
}

/** Quote an argument for a POSIX shell when it is not plainly safe. */
function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

function shellLine(cmd: string[]): string {
  return cmd.map(shellQuote).join(" ");
}

/**
 * Write the PR body for `gh pr create --body-file` inside the git dir: untracked,
 * kept for a human who runs the command later, and overwritten on the next close.
 */
async function writeBodyFile(root: string, story: string, text: string): Promise<string> {
  const gitDir = (await run(["git", "rev-parse", "--absolute-git-dir"], root)).trim();
  const f = join(gitDir, `epic-pr-body-${story}.md`);
  writeFileSync(f, text);
  return f;
}

/** The PR number at the end of a `.../pull/<n>` URL. */
function prNumber(url: string): number {
  return Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
}

/** The body of the story PR: the ledger entry, then what happens after the merge. */
export function prBody(epic: EpicPackage, story: string, dir: string, nextStory: string, branch: string): string {
  const entry = ledgerEntry(epic.text, story);
  const parts = [
    `Story ${story} into \`${branch}\` (epic ${epic.id} — ${epic.title}).`,
    "",
    "## Ledger entry",
    "",
    entry || "_(none)_",
    "",
  ];
  if (nextStory !== "none") {
    parts.push(
      "## Handoff",
      "",
      `\`${dir}/HANDOFF.md\` is written for **${nextStory}**. After this PR merges, reply \`next\` to the ` +
        'closing agent, or press "Start next story" in the Epic panel.',
      "",
    );
  } else {
    parts.push("## Epic", "", `This was the last story; ${epic.id} is closed.`, "");
  }
  return parts.join("\n");
}

/**
 * Commit the epic folder on the story branch, push it, and open the story PR
 * into the epic branch (plus a draft epic PR into the base branch when the
 * handoff says `next=none`). It checks no content. Steps it skips are
 * returned in `manual`.
 */
export async function cmdClose(
  root: string,
  config: EpicConfig,
  story: string,
  opts: { noPr?: boolean; noGh?: boolean } = {},
): Promise<CloseResult> {
  const d = findEpicDir(root, config, story);
  const { epic, handoff } = loadLocal(d);
  const branch = await currentBranch(root);
  // The longest row id wins, so on `feat/S-1-x` the story is S-1, never S.
  if (storyOfName([...storyIds(epic), story], config.branchPrefix, branch) !== story) {
    throw new EpicError(
      `current branch \`${branch}\` is not the story branch for ${story}; ` +
        `check out \`${config.branchPrefix}${story}-…\` and run close again`,
    );
  }
  const target = epicBranch(config, d);
  const rel = gitRel(root, d);
  const header = requireHeader(handoff, `in ${rel}`);
  // The plugin reads these two fields itself (next reads after=, start reads next=), so they are flow state.
  if (header.after !== story) {
    throw new EpicError(`HANDOFF.md says after=${header.after}; set after=${story} before epic_close`);
  }
  if (header.next === story) {
    throw new EpicError(`HANDOFF.md still says next=${story}; point next= at the following story or none`);
  }
  const nextStory = header.next;

  const others = splitLines(await gitDirty(root)).filter((ln) => !ln.includes(rel));
  if (others.length > 0) {
    throw new EpicError(
      `uncommitted changes outside the epic folder; commit the story work first:\n  ${others.join("\n  ")}`,
    );
  }
  await run(["git", "add", "-A", rel], root);
  const staged = (await run(["git", "diff", "--cached", "--name-only"], root)).trim();
  let committed = false;
  let message = "epic folder already committed";
  if (staged) {
    message = `docs(${epic.id}): close ${story}; handoff for ${nextStory}`;
    await run(["git", "commit", "-q", "-m", message], root);
    committed = true;
  }

  const row = rowOf(epic, story);
  const title = row?.title ? `${story}: ${row.title}` : story;
  const body = prBody(epic, story, rel, nextStory, target);
  const pushCmd = ["git", "push", "-u", "origin", branch];
  const prCmd = (bodyFile: string) => [
    "gh", "pr", "create", "--base", target, "--head", branch, "--title", title, "--body-file", bodyFile,
  ];
  const epicClosed = nextStory === "none";
  const epicPrCmd = [
    "gh", "pr", "create", "--draft", "--base", config.baseBranch, "--head", target,
    "--title", `${epic.id}: ${epic.title}`,
    "--body",
    `Epic ${epic.id} closed. See \`${rel}/EPIC.md\` §Ledger. Merge after the last story PR lands.`,
  ];
  const result: CloseResult = { committed, message, pushed: false, pr: null, epicPr: null, manual: [] };

  if (opts.noPr) {
    result.manual.push(shellLine(pushCmd));
  } else {
    await run(pushCmd, root);
    result.pushed = true;
  }
  if (opts.noPr || opts.noGh || !(await ghAvailable())) {
    result.manual.push(shellLine(prCmd(await writeBodyFile(root, story, body))));
    if (epicClosed) result.manual.push(shellLine(epicPrCmd));
    return result;
  }

  const existing = await ghOpenPrs(root, target, branch);
  if (existing.length > 0) {
    result.pr = { number: existing[0].number, url: existing[0].url };
  } else {
    const url = (await run(prCmd(await writeBodyFile(root, story, body)), root)).trim();
    result.pr = { number: prNumber(url), url };
  }
  if (epicClosed) {
    const epicPrs = await ghOpenPrs(root, config.baseBranch, target);
    const url = epicPrs.length > 0 ? epicPrs[0].url : (await run(epicPrCmd, root)).trim();
    result.epicPr = { url };
  }
  return result;
}

/**
 * The PR in `prs` whose head is `<prefix><story>-*`, matched on the head name
 * only. `ids` are the package's story ids: a head `feat/S-1-x` is S-1's PR, not S's.
 */
export function pickMergedPr<T>(
  prs: Array<{ headRefName: string } & T>,
  story: string,
  prefix: string,
  ids: readonly string[],
): T | null {
  return prs.find((pr) => storyOfName([...ids, story], prefix, pr.headRefName) === story) ?? null;
}

/**
 * After the story PR merged: require `after=<story>` in the handoff on the
 * epic tip, read the merged PR and its comments, and name the next story
 * (the tip's `next=`) and its branch.
 */
export async function cmdNext(
  root: string,
  config: EpicConfig,
  story: string,
  opts: { noGh?: boolean } = {},
): Promise<NextResult> {
  const d = findEpicDir(root, config, story);
  const branch = epicBranch(config, d);
  await run(["git", "fetch", "origin", "--prune"], root);
  if (!(await remoteBranchExists(root, branch))) {
    throw new EpicError(`origin/${branch} does not exist; push the epic branch first`);
  }

  // Merged means: the close commit (with the rewritten handoff) is on the epic tip.
  const { epic, handoff: tipHandoff } = await loadFromRef(root, d, `origin/${branch}`);
  const handoff = requireHeader(tipHandoff, `on origin/${branch}`);
  if (handoff.after !== story) {
    // A later row closed since: point at it instead of saying "not merged".
    const order = storyIds(epic);
    const later = order.includes(story) && order.indexOf(handoff.after) > order.indexOf(story);
    if (later) {
      throw new EpicError(
        `${story} is not the last closed story on origin/${branch}; ` +
          `the handoff there says after=${handoff.after}, so run next ${handoff.after}`,
      );
    }
    throw new EpicError(
      `${story} is not merged into origin/${branch} yet (the handoff there says after=${handoff.after}); ` +
        "merge the story PR first, then run next again",
    );
  }

  let pr: MergedPr | null = null;
  let comments: PrComment[] = [];
  if (!opts.noGh && (await ghAvailable())) {
    pr = pickMergedPr(await ghMergedPrs(root, branch), story, config.branchPrefix, storyIds(epic));
    if (pr === null) {
      throw new EpicError(
        `no merged PR into ${branch} has a \`${config.branchPrefix}${story}-*\` head; merge the story PR first`,
      );
    }
    comments = await ghPrComments(root, pr.number);
  }

  const out: NextResult = { epic: epic.id, epicBranch: branch, closed: { story, pr, comments }, next: null };
  const nxt = handoff.next;
  if (nxt !== "none") {
    const row = rowOf(epic, nxt);
    out.next = {
      story: nxt,
      title: row?.title ?? "",
      lane: row?.lane ?? "",
      branch: `${config.branchPrefix}${nxt}-${await storySlug(root, d, branch, nxt, epic)}`,
      baseRef: `origin/${branch}`,
    };
  }
  return out;
}

/**
 * The package for `status` without a ref, never ambiguous: the one whose epic
 * branch is checked out; else the one with the row for the checked-out story
 * branch (the longest id across all packages); else the newest package whose
 * handoff does not say `next=none`; else the newest package. Newest is the
 * highest epic id in natural order (E9 < E10).
 */
export async function statusDir(root: string, config: EpicConfig): Promise<string> {
  const base = epicsDir(root, config);
  const packages = subdirs(base)
    .filter(hasMarkers)
    .map((d) => ({ d, ...loadLocal(d) }));
  if (packages.length === 0) throw new EpicError(`no epic package under ${base}; run init first`);
  const branch = (await runRaw(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim();
  const onEpic = packages.find(({ d }) => epicBranch(config, d) === branch);
  if (onEpic) return onEpic.d;
  const story = storyOfName(packages.flatMap(({ epic }) => storyIds(epic)), config.branchPrefix, branch);
  const onStory = story === undefined ? undefined : packages.find(({ epic }) => rowOf(epic, story) !== undefined);
  if (onStory) return onStory.d;
  const open = packages.filter(({ handoff }) => handoff?.next !== "none");
  const pool = open.length > 0 ? open : packages;
  const newer = (a: string, b: string) => folderEpicId(b).localeCompare(folderEpicId(a), undefined, { numeric: true }) > 0;
  return pool.reduce((a, b) => (newer(a.d, b.d) ? b : a)).d;
}

/**
 * Read-only summary of the local package for the panel: the rows, the Status
 * block values as written, and `next` from the handoff header ("" without
 * one). `behind` is null when either branch is missing on the remote;
 * `openPr` is null without gh or when gh cannot list PRs for this remote.
 */
export async function cmdStatus(root: string, config: EpicConfig, ref?: string): Promise<StatusResult> {
  const d = ref ? findEpicDir(root, config, ref) : await statusDir(root, config);
  const { epic, handoff } = loadLocal(d);
  const branch = epicBranch(config, d);
  const count = await runRaw(["git", "rev-list", "--count", `origin/${branch}..origin/${config.baseBranch}`], root);
  let openPr: StatusResult["openPr"] = null;
  if (await ghAvailable()) {
    try {
      const prs = await ghOpenPrs(root, branch);
      if (prs.length > 0) openPr = { number: prs[0].number, url: prs[0].url, headRefName: prs[0].headRefName };
    } catch (err) {
      // Status never refuses: a remote gh cannot read (not GitHub, no auth) has no PR to show.
      if (!(err instanceof EpicError)) throw err;
    }
  }
  return {
    epic: epic.id,
    title: epic.title,
    epicBranch: branch,
    state: epic.status.State ?? "",
    stories: epic.status.Stories ?? "",
    next: handoff?.found ? handoff.next : "",
    behind: count.code === 0 ? count.stdout.trim() : null,
    rows: epic.rows,
    openPr,
    closeHooks: config.hooks.close,
  };
}
