import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  checkPackage,
  counts,
  epicBranch,
  expectedNext,
  expectedState,
  renderStatus,
  rowOf,
} from "./check";
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
  epicsDir,
  findEpicDir,
  gitRel,
  hasMarkers,
  loadFromRef,
  loadLocal,
  packetSlug,
  subdirs,
} from "./locate";
import { ledgerEntry, parseEpic, splitLines } from "./parse";
import { slugify, today } from "./slug";
import { templateText } from "./templates";
import { EPIC_ID_RE, type EpicPackage, EpicError, type Row, STORY_ID_BODY, STORY_ID_RE } from "./types";

/** A story branch name after its prefix: `<story>-<slug>`. */
const STORY_BRANCH_RE = new RegExp(`^(${STORY_ID_BODY})-`);

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
    throw new EpicError(
      `the package on origin/${branch} does not pass check; fix the listed problems on the epic branch, ` +
        `then run start again:\n  - ${problems.join("\n  - ")}`,
    );
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
  problems: string[];
}

function requireStoryId(story: string): void {
  if (!STORY_ID_RE.test(story)) throw new EpicError(`\`${story}\` is not a story id like TH-652`);
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
export function prBody(epic: EpicPackage, story: string, dir: string, nextStory: string): string {
  const entry = ledgerEntry(epic.text, story);
  const branch = epicBranch(epic);
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
  parts.push("🤖 Generated with [Claude Code](https://claude.com/claude-code)");
  return parts.join("\n");
}

/**
 * What stops `story` from closing: `check` on the package with the Status block
 * rendered in memory, plus the three close rules. Writes nothing.
 */
export async function closeProblems(root: string, config: EpicConfig, story: string): Promise<string[]> {
  requireStoryId(story);
  const loaded = loadLocal(findEpicDir(root, config, story));
  const handoff = loaded.handoff;
  // Without markers there is nothing to render; check reports them missing.
  const epic =
    loaded.epic.statusSpan === null ? loaded.epic : parseEpic(loaded.epic.path, renderStatus(loaded.epic));
  const problems = checkPackage(epic, handoff);
  const row = rowOf(epic, story);
  if (row && row.status !== "implemented") {
    problems.push(`EPIC.md: ${story} row is \`${row.status}\`, expected \`implemented\``);
  }
  const last = epic.ledger.at(-1);
  if (last && last.id !== story) {
    problems.push(`EPIC.md: last ledger entry is ${last.id}, expected ${story}`);
  }
  if (handoff?.found && handoff.after !== story) {
    problems.push(`HANDOFF.md: after=${handoff.after}, expected ${story}`);
  }
  return problems;
}

/**
 * Render and check the package, commit the epic folder on the story branch,
 * push it, and open the story PR into the epic branch (plus a draft epic PR
 * into the base branch once no open rows remain). Steps it skips are
 * returned in `manual`.
 */
export async function cmdClose(
  root: string,
  config: EpicConfig,
  story: string,
  opts: { noPr?: boolean; noGh?: boolean } = {},
): Promise<CloseResult> {
  requireStoryId(story);
  const branch = await currentBranch(root);
  if (!branch.includes(story)) {
    throw new EpicError(
      `current branch \`${branch}\` is not the story branch for ${story}; ` +
        `check out \`${config.branchPrefix}${story}-…\` and run close again`,
    );
  }
  const d = findEpicDir(root, config, story);
  const before = loadLocal(d).epic;
  if (before.statusSpan !== null) {
    const text = renderStatus(before);
    if (text !== before.text) writeFileSync(before.path, text);
  }
  const problems = await closeProblems(root, config, story);
  if (problems.length > 0) {
    throw new EpicError(`the package is not ready to close:\n  - ${problems.join("\n  - ")}`);
  }
  const { epic } = loadLocal(d);
  const target = epicBranch(epic);
  const nextStory = expectedNext(epic);

  const rel = gitRel(root, d);
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
  const title = row ? `${story}: ${row.title}` : story;
  const body = prBody(epic, story, rel, nextStory);
  const pushCmd = ["git", "push", "-u", "origin", branch];
  const prCmd = (bodyFile: string) => [
    "gh", "pr", "create", "--base", target, "--head", branch, "--title", title, "--body-file", bodyFile,
  ];
  const [done, total] = counts(epic);
  const epicClosed = expectedState(epic) === "closed";
  const epicPrCmd = [
    "gh", "pr", "create", "--draft", "--base", config.baseBranch, "--head", target,
    "--title", `${epic.id}: ${epic.title}`,
    "--body",
    `Epic ${epic.id} closed: ${done} of ${total} stories implemented. ` +
      `See \`${rel}/EPIC.md\` §Ledger. Merge after the last story PR lands.`,
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

/** The PR in `prs` whose head is `<prefix><story>-*`, matched on the head name only. */
export function pickMergedPr<T>(prs: Array<{ headRefName: string } & T>, story: string, prefix = "feat/"): T | null {
  return prs.find((pr) => pr.headRefName.startsWith(`${prefix}${story}-`)) ?? null;
}

/**
 * After the story PR merged: require the close commit on the epic tip, read
 * the merged PR and its comments, and name the next story and its branch.
 */
export async function cmdNext(
  root: string,
  config: EpicConfig,
  story: string,
  opts: { noGh?: boolean } = {},
): Promise<NextResult> {
  requireStoryId(story);
  const d = findEpicDir(root, config, story);
  const branch = epicBranch(loadLocal(d).epic);
  await run(["git", "fetch", "origin", "--prune"], root);
  if (!(await remoteBranchExists(root, branch))) {
    throw new EpicError(`origin/${branch} does not exist; push the epic branch first`);
  }

  // Merged means: the close commit (ledger entry + handoff) is on the epic tip.
  const { epic, handoff } = await loadFromRef(root, d, `origin/${branch}`);
  const problems = checkPackage(epic, handoff);
  if (problems.length > 0) {
    throw new EpicError(
      `the package on origin/${branch} does not pass check; fix the listed problems on the epic branch, ` +
        `then run next again:\n  - ${problems.join("\n  - ")}`,
    );
  }
  const ledgerIds = epic.ledger.map((l) => l.id);
  const last = ledgerIds.at(-1) ?? "none";
  if (ledgerIds.includes(story) && last !== story) {
    throw new EpicError(
      `${story} closed earlier; the last story closed on origin/${branch} is ${last}, so run \`next ${last}\``,
    );
  }
  if (last !== story) {
    throw new EpicError(
      `${story} is not merged into origin/${branch} yet (last ledger entry there is ${last}); ` +
        "merge the story PR first, then run next again",
    );
  }

  let pr: MergedPr | null = null;
  let comments: PrComment[] = [];
  if (!opts.noGh && (await ghAvailable())) {
    pr = pickMergedPr(await ghMergedPrs(root, branch), story, config.branchPrefix);
    if (pr === null) {
      throw new EpicError(
        `no merged PR into ${branch} has a \`${config.branchPrefix}${story}-*\` head; merge the story PR first`,
      );
    }
    comments = await ghPrComments(root, pr.number);
  }

  const out: NextResult = { epic: epic.id, epicBranch: branch, closed: { story, pr, comments }, next: null };
  const nxt = expectedNext(epic);
  if (nxt !== "none") {
    // expectedNext() returned an id from the story list, so the row exists.
    const row = rowOf(epic, nxt) as Row;
    const slug = (await packetSlug(root, d, branch, nxt)) ?? slugify(row.title);
    out.next = {
      story: nxt,
      title: row.title,
      lane: row.lane,
      branch: `${config.branchPrefix}${nxt}-${slug}`,
      baseRef: `origin/${branch}`,
    };
  }
  return out;
}

/** The number in the package folder's epic id (E20 -> 20), for picking the newest. */
function epicNumber(dir: string): number {
  return Number(basename(dir).split("-")[0].slice(1)) || 0;
}

/**
 * The package for `status` without a ref, never ambiguous: the one whose epic
 * branch is checked out or whose story list holds the checked-out story; else
 * the newest package that is not closed; else the newest package.
 */
export async function statusDir(root: string, config: EpicConfig): Promise<string> {
  const base = epicsDir(root, config);
  const packages = subdirs(base)
    .filter(hasMarkers)
    .map((d) => ({ d, epic: loadLocal(d).epic }));
  if (packages.length === 0) throw new EpicError(`no epic package under ${base}; run init first`);
  const branch = (await runRaw(["git", "rev-parse", "--abbrev-ref", "HEAD"], root)).stdout.trim();
  const story = branch.startsWith(config.branchPrefix)
    ? STORY_BRANCH_RE.exec(branch.slice(config.branchPrefix.length))?.[1]
    : undefined;
  const hit = packages.find(
    ({ epic }) => epicBranch(epic) === branch || (story !== undefined && rowOf(epic, story) !== undefined),
  );
  if (hit) return hit.d;
  const open = packages.filter(({ epic }) => epic.status.State !== "closed");
  const pool = open.length > 0 ? open : packages;
  return pool.reduce((a, b) => (epicNumber(b.d) > epicNumber(a.d) ? b : a)).d;
}

/**
 * Read-only summary of the local package for the panel. `behind` is null when
 * either branch is missing on the remote; `openPr` is null without gh or when
 * gh cannot list PRs for this remote.
 */
export async function cmdStatus(root: string, config: EpicConfig, ref?: string): Promise<StatusResult> {
  const d = ref ? findEpicDir(root, config, ref) : await statusDir(root, config);
  const { epic, handoff } = loadLocal(d);
  const branch = epicBranch(epic);
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
    next: epic.status.Next ?? "",
    behind: count.code === 0 ? count.stdout.trim() : null,
    rows: epic.rows,
    openPr,
    problems: checkPackage(epic, handoff),
  };
}
