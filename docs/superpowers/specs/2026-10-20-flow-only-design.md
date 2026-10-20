# paseo-epic runs the flow only

Date: 2026-10-20. Status: approved by the owner (sidera-engine TH-81 plan,
"Plugin follow-up").

## Problem

The plugin holds rules that belong to the repo that uses it. When sidera-engine
changed its story ids to `TH-E09-3`, the plugin needed a release (#6, `bd28325`).
The plugin checks the id shape (`STORY_ID_RE`, `EPIC_ID_RE`), lints the package
(`checkPackage`, `closeProblems`), rewrites the Status block (`renderStatus`),
and ships templates and prompt text with another project's rules (`scripts/epic.py`,
`harness-cli`, "Inflow design system", `TH-0193`, `bun run test`, the ledger's
five bullets).

## Decision

The plugin is the engine only:

- **Flow:** `epic_init`, `epic_start`, `epic_close`, `epic_next`, `epic_status`,
  spawning the next agent.
- **Git and PR mechanics:** branches, commit of the epic folder, push, story PR,
  draft epic PR, the merged-PR lookup.
- **Context preparation:** give the agent `HANDOFF.md` and the `.epic.yml` hook
  text at the right moment.
- **Flow guards** (kept, owner decision): a clean tree, the epic branch pushed,
  no open story PR into the epic branch, on the story branch at close, no
  uncommitted changes outside the epic folder at close, the story merged before
  `next`.

It checks no ids and no file content. The repo owns those rules (sidera-engine:
`scripts/check_epic.py`, run by its `.epic.yml` hooks and CI).

## What the plugin still reads

| Read | From | Used for |
| --- | --- | --- |
| Epic id | the folder name before the first `-` | finding the package, the default epic branch |
| Title | the H1 after the id and a dash, if present | display, PR titles |
| Story rows | `## Story list` table, `<!-- -->` blocks skipped; the id is the first word of the first cell | title, lane, status for display; slug of the story branch |
| Handoff header | `<!-- handoff: epic=… after=… next=… written=… -->` in `HANDOFF.md` | **the next story** (`next=`) and **the last closed story** (`after=`) |
| Status block | the lines between the markers, verbatim | display only |
| Ledger entry | `### <story> …` under `## Ledger`, `<!-- -->` blocks skipped | the story PR body |

Nothing read is validated. A missing value gives a refusal that names what the
flow needs (for example "HANDOFF.md on origin/epic/E10-x has no handoff
header"), not a lint list.

## Changes

### Ids are opaque

- Remove `STORY_ID_RE`, `STORY_ID_BODY`, `EPIC_ID_RE`.
- `findEpicDir(ref)`: a folder whose prefix before the first `-` equals `ref`;
  else a package whose story table has a row with id `ref`; else a folder named
  `ref`; else refuse. Keep the "more than one" refusals.
- `statusDir`: the checked-out branch names a story when it starts with
  `<branchPrefix><row id>-` for a row of a package (match against the table,
  not a regex).
- The spawn-pending line: `^Spawn pending for (\S+) after (\S+): the plugin starts the successor now\.$`.
- `story-changes.ts`: refuse a story that is not a row of the package, instead
  of a story id that fails the regex.

### No package lint

- Remove `checkPackage`, `renderStatus`, `closeProblems`, `cmdCheck`,
  `cmdRender`, `expectedState`, `counts`, and their constants (`STATES`,
  `ROW_STATUSES`, `HANDOFF_HEADINGS`, `DATE_RE`), and `pyTuple` / `pyList`.
  `expectedNext` goes too: the next story is the handoff's `next=`.
- Remove the MCP tools `epic_check` and `epic_close_check`, the `checkRpc`
  contract and handler, `problems` in the status result, and the panel's Check
  button and "Last check" lines.
- Keep `epicBranch` and `rowOf` (move them out of `check.ts`; delete the file if
  nothing else is left).

### The flow reads the handoff header

- `cmdStart`: after the guards, read `HANDOFF.md` on `origin/<epic branch>`.
  The story is `next=`. `none` → refuse "no open story". When `ref` is a story
  and not `next=` → refuse as today ("the handoff on origin/… was written for
  X, not Y"). The row gives title and lane when it exists; the branch slug is
  the packet folder slug on the tip (as today), else `slugify(title)`, else
  `slugify(story)`.
- `cmdClose`: the guards, then commit, push, PR, with no render and no check.
  The next story for the PR body is the local `HANDOFF.md` `next=`. The epic is
  closed (draft epic PR) when `next=none`. The epic PR body drops the
  "N of M stories" count.
- `cmdNext`: merged means `after=<story>` in `HANDOFF.md` on the epic tip, plus
  the merged PR when `gh` is there (as today). Otherwise refuse "not merged
  into origin/… yet (the handoff there says after=X)". The next story is
  `next=` on the tip.
- `lastClosedStory` (rpc/next.ts): the local handoff's `after=` (`none` →
  refuse as today).
- `cmdStatus`: rows, the Status block values verbatim, `next` = handoff
  `next=`, `behind`, `openPr`. No problems.

### Hook text, not plugin rules

- New `.epic.yml` key `hooks.init: string[]` (default `[]`), quoted after
  `epic_init`. `afterInit` becomes neutral: fill EPIC.md and HANDOFF.md,
  follow the init lines, commit and push the epic branch, start the first story
  in a fresh agent with `epic_start`.
- The close hooks are quoted by `epic_start` (after the start hooks, under
  "When the story is done:") and by `closeInstructions` (the panel's close
  prompt). `closeInstructions` keeps only: the hook lines, then "call
  epic_close with <story>". The ledger-bullet and Done-cell rules go: they are
  repo rules.
- `epic_close` description: "Call when the story is done and the close steps
  from epic_start are met: it commits the epic folder, pushes, and opens the
  story PR."
- `noEpicYet`: "Call epic_init with an epic id and a title" (no `E1` example:
  the repo mints ids).
- New `.epic.yml` key `epicBranchPrefix` (default `epic/`); `epic_init` cuts
  `<epicBranchPrefix><folder>`, and the epic branch is always that (the Status
  block `Branch:` line is display only).

### Neutral default templates

`templates/epic.md`, `templates/handoff.md` and `default-templates.ts`: the
same machine-read shape (Status markers, `## Story list`, `## Ledger`, the
handoff header and five numbered headings), with placeholder ids like `S-1`,
and no project rules or tool names. A repo overrides them with `templates:`.

### Docs

`README.md`, `docs/README.md`, `docs/routine.md`, `docs/epic-yml.md`: the plugin
runs the flow; the repo owns the rules and points to them from `.epic.yml`; the
two new keys; no `/epic` slash command examples (agents use the `epic_*`
tools).

## Migration and order

1. sidera-engine #113 merges first (its `.epic.yml` hooks run
   `scripts/check_epic.py`), and `main` is merged into every running epic branch.
2. Then this PR merges, while no epic story agent is running: it removes
   `epic_check` and `epic_close_check`, which a running agent may still call.
3. A repo may add `hooks.init` and `epicBranchPrefix` to `.epic.yml` only after
   this PR is installed: the schema is strict, so the old plugin refuses the
   new keys.

## Tests

- Remove the lint tests (`parse-check.test.ts` lint cases, `checkPackage` /
  `cmdRender` uses in `git-flow.test.ts` and `fixtures.ts`).
- Add: ids of any shape (`TH-E10-1`, `story-7`, `ABC`) work through start,
  close, next and status; a commented `### TH-NNN — YYYY-MM-DD` ledger example
  is not read as an entry; `next=` drives `epic_start`; `after=` drives
  `epic_next`; every flow guard still refuses; `hooks.init` and the close hooks
  are quoted; `epicBranchPrefix` is used by init and start; the MCP tool list
  no longer has `epic_check` / `epic_close_check`.
- `npm run typecheck`, `npm test`, and `npm run build:mcp` (the committed
  bundle must match the sources).
