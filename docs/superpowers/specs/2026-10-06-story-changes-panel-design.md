# Story changes in the Epic panel

Date: 2026-10-06
Status: approved in conversation, written for review
Builds on: `2026-10-01-paseo-epic-plugin-design.md` (the plugin), section 7 (the panel)

## 1. Purpose

Agents build stories in worktrees and ask the user to review. Paseo gives the
user no path from where they are (usually the main checkout) to the story's
worktree and its changed files. They find both by hand.

This feature makes the Epic panel the place to look. From any workspace of
the repo, the user expands a story row and sees the story's workspace and
agent with jump buttons, the pull request, and the list of files the story
created or changed, committed or not. One click opens the worktree workspace
in Paseo, where the built-in Diff and Files tabs do the review.

The panel also gets a clearer status view: a colored status dot per story,
the in-progress story expanded by default, and the counts the user asked for.

Single user, single epic, as before.

## 2. Scope

In scope:

- A new core function `storyChanges` (committed and uncommitted changes of a
  story worktree against the epic branch).
- A new RPC `epic.story-changes` that resolves a story's workspace, agent and
  PR and returns its changes.
- Expandable story rows in the Epic panel with jump buttons, PR link, and the
  file list.
- Tests for the core function and the handler; manual rows for the panel.
- Docs: README panel section, user guide, verification rows.

Out of scope:

- Opening a file in an external editor. Paseo's plugin API opens only
  workspaces, agents, and HTTP URLs; the Diff and Files tabs are not
  reachable from a plugin.
- Live refresh when the agent commits. The panel reads on expand and on
  Refresh; no timers.
- A view across several epics or projects.
- Any change to `.epic.yml`, to the MCP tools, or to the spawn.

## 3. What "changes" means

For a story on branch `<branchPrefix><story>-<slug>` in a worktree whose epic
branch is `epic/<E>-<slug>`:

- **Committed:** `git diff --name-status origin/<epic branch>...HEAD` in the
  worktree. Three dots: changes since the branch left the epic, so a merge of
  main into the epic does not pollute the list.
- **Uncommitted:** `git status --porcelain --untracked-files=all` in the
  worktree. Untracked files are `A`. A file in both lists is reported once
  with `committed: false`.
- Renames are reported once, with the new path and status `R`.
- Paths are relative to the worktree root. The worktree root is returned too.
- No fetch. `origin/<epic branch>` is read as last fetched, like `status`.

```
storyChanges(dir: string, epicBranch: string): Promise<StoryChanges>

StoryChanges = {
  base: string;      // "origin/epic/E102-sidera-data"
  head: string;      // "feat/TH-686-query-recovery"
  ahead: number;     // commits on head not on base
  files: Array<{ path: string; status: "A" | "M" | "D" | "R"; committed: boolean }>;
}
```

Refusal, one sentence: `origin/<epic branch> does not exist; push the epic
branch first`.

## 4. The RPC `epic.story-changes`

Input: `{ workspaceDir: string; story: string }`.

Resolution, in the handler:

1. Package and row: `findEpicDir(root, config, story)` gives the epic branch
   and the story row. Unknown story → refusal `no epic package lists
   <story>; check the story id`.
2. Workspace: `paseo.workspaces.list()`, the entry whose current branch starts
   with `<branchPrefix><story>-` (the same match the spawn uses). When the
   caller's own workspace is on that branch, it is the match.
3. Agent: `paseo.agents.list()`, newest agent whose status is not `closed`
   and whose label `epic.story` equals the story; else the newest such agent
   whose cwd is the story workspace directory or under it.
4. PR: with `gh`, the open PR into the epic branch whose head is the story
   branch; else, for an implemented row, the merged PR by head prefix. Without
   `gh`, `null`.
5. Changes: `storyChanges(workspace.directory, epicBranch)` when a workspace
   was found.

Output:

```
{
  story: "TH-686",
  title: "Query recovery",
  status: "in_progress",
  done: "",
  workspace: { id: "wks_x", directory: "/…/inflow-e102-sidera-data", name: "…" } | null,
  agent: { id: "ag_y", title: "TH-686 Query recovery", status: "idle" } | null,
  pr: { number: 296, url: "https://github.com/o/r/pull/296", state: "open" | "merged" } | null,
  changes: StoryChanges | null,
  note: string | null   // "no workspace for TH-686 on this daemon" when workspace is null
}
```

Missing workspace, agent or PR are `null`, never errors. The only refusals
are the unknown story and the missing remote epic branch.

Implementation note (2026-10-06): the workspace and agent search is scoped to the caller's project; the package is read from the panel's checkout, so a checkout without the epic package cannot show it (follow-up: read from origin/epic/*).

## 5. The panel

The header, the two buttons and the result area stay as they are. The story
table changes:

- Each row is a `Pressable` with a chevron. Columns: id and title, lane,
  status, done. The status has a colored dot: `theme.colors.accent` for
  `in_progress`, `foreground` for `implemented`, `foregroundMuted` for
  `planned` and `dropped`.
- The `in_progress` row starts expanded. When no row is in progress, the
  `Next` story's row does. Expanding a row calls `epic.story-changes` once.
  A **Refresh** link in the expanded area calls it again.
- The expanded area, top to bottom:
  - `workspace <name>` and **Open workspace**; `agent <title> (<status>)`
    and **Open agent**. Buttons render only when the host passes
    `navigation`; older hosts see the names as text. `Open workspace` calls
    `navigation.openWorkspace({ workspaceId })`; `Open agent` calls
    `navigation.openAgent({ agentId })`.
  - `PR #n` as a link through `navigation.openBrowser` when present, else the
    URL as selectable text; or the row's Done text when there is no URL.
  - `changes vs <base>: <n> files, <m> uncommitted`, then one line per file:
    status letter, path, and an `uncommitted` tag. Paths are selectable text.
  - The note line when there is no workspace.
- Compact layout: id and title on one line, lane, status and done on the
  next, as today. File lines show the status letter and the last two path
  segments; the full path is the selectable text.
- RPC errors show inline in the expanded area.

Files: `client/StoryRow.tsx` (row and expanded area), `client/FileList.tsx`,
labels in `client/strings.ts`. `client/EpicPanel.tsx` composes them and
stays near its current size.

Review flow after this change: open the Epic panel in any workspace of the
repo, expand the story, press **Open workspace**, review in Paseo's Diff tab.

Implementation note (2026-10-06): compact rows show the full path cut at the start (ellipsizeMode head), not the last two segments.

## 6. Errors

- Refusals are one sentence with the next step, as `EpicError`, converted to
  plain errors by the handler layer as today.
- Missing workspace, agent or PR are `null` fields with a `note`, never
  errors.
- `gh` missing: `pr: null`.
- A `storyChanges` git failure other than the missing base is reported as the
  RPC error text, inline in the row.

## 7. Testing

- `test/changes.test.ts`, on the bare-remote fixture after `planAndPush` and
  `cmdStart`: one committed modified file, one committed new file, one
  committed deletion, one uncommitted edit on a committed file, one untracked
  file, one rename; `ahead` equals the commit count; the refusal when the
  remote epic branch is missing.
- `test/handlers.test.ts` (new) with a fake `PaseoApi`: the workspace is found
  by branch; the agent by label, then by cwd; all three `null` plus the note
  when nothing matches; the handler never throws for a story without a
  workspace.
- Client: `npm run typecheck`, the mobile audit, `test/strings.test.ts` for
  shared text.
- `docs/VERIFICATION.md` rows: a row expands in the main checkout and shows
  the worktree's files; **Open workspace** lands in the worktree; the list
  matches `git status` and `git diff --name-status` there; compact layout and
  a second theme.

## 8. Docs

- `README.md`: "The Epic panel" section describes the expanded row and the
  review flow; the three-callers table notes the panel can open the story's
  workspace and agent.
- `docs/README.md`: the same, plus the `epic.story-changes` RPC in the plugin
  overview.
- `docs/VERIFICATION.md`: the rows above, pending.

## 9. Facts to verify at plan time

- The exact field names of a workspace list entry for its current branch and
  directory in `@getpaseo/client` 0.10.2 (`findWorkspaceByBranch` in
  `server/rpc/handlers.ts` already reads them; reuse it).
- The agent list entry shape (`{ agent, project }`, `agent.labels`,
  `agent.cwd`, `agent.status`, `agent.title`) in the same package.
- Whether `navigation.openWorkspace` switches the app to that workspace or
  only selects it in the sidebar. The manual verification row records what
  it does.
