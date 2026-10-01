# paseo-epic: a native Paseo plugin for running an epic story by story

Date: 2026-10-01
Status: approved in conversation, written for review
Origin: the `/epic` skill in the inflow repo (`.claude/skills/epic/SKILL.md`, `scripts/epic.py`)

## 1. Purpose

An epic is a planned list of user stories built in order on one branch. The
detail of each finished story changes the plan for the next one. This plugin
keeps that chain honest and short:

- one file carries the plan and the history (`EPIC.md`),
- one file carries the brief for the next story (`HANDOFF.md`),
- a fresh agent starts every story from the merged handoff,
- the human gate is the pull request merge, and the trigger after it is one
  action: the word `next` to the closing agent, or a button in Paseo.

The plugin moves the routine out of one project's skill folder into a Paseo
plugin that any Paseo user can install. It ships the mechanics, the
instruction text for agents, a panel, a slash command, and an MCP server.

### Single user, single epic

This plugin is for **one person running a whole epic on one daemon**. One
story is in flight at a time, one agent builds it, one human merges. It is
not a tool for several members sharing one epic. The design assumes a single
actor everywhere: no locks, no assignment, no per-member state. The README
says this in its first paragraph.

## 2. Scope

In scope:

- Package mechanics: `init`, `start`, `close`, `next`, `check`, `status`.
- A TypeScript core, tested, ported one-to-one from `epic.py`.
- An Epic workspace panel, an `/epic` slash command, a Command Center item.
- An `epic` MCP server injected into agents created in epic workspaces.
- `next` creates the successor worktree and agent through the daemon SDK.
- An optional `.epic.yml` in the user's repo for hook text and overrides.
- Default templates for `EPIC.md` and `HANDOFF.md`.
- Publishing to npm and installing from GitHub.

Out of scope:

- Several people sharing one epic.
- Background polling of pull requests. The human merges and triggers.
- GitHub stacked pull requests.
- Paseo Hub triggers or any webhook path.
- A default method for building a story. Between `start` and `close` the
  agent works however the user likes. `.epic.yml` can add text, not rules.
- Running commands from `.epic.yml`. The plugin only quotes its text.

## 3. Architecture

```
 +---------------------- paseo-epic plugin ----------------------+
 |                                                                |
 |  client/  (Paseo app, React Native)                            |
 |    Epic panel       /epic slash command     Command Center     |
 |         |                  |                     |             |
 |         +---------- RPC (zod contracts in shared/) ------------+
 |                            |                                   |
 |  server/  (daemon subprocess, Node)                            |
 |    core/   parse EPIC.md + HANDOFF.md, check, render,          |
 |            git + gh mechanics  (TS port of epic.py, tested)    |
 |    rpc/    init / start / close / next / check / status        |
 |    hooks   before agent.create -> inject `epic` MCP server     |
 |    mcp/    stdio MCP server exposing the same core to agents   |
 +----------------------------------------------------------------+
            |                                   |
            v                                   v
   user repo: docs/stories/epics/<E>/      Paseo SDK: workspaces,
   EPIC.md, HANDOFF.md, .epic.yml          agents, profiles
```

Three callers, one core:

| Caller | Entry | Calls |
| --- | --- | --- |
| Human | Epic panel, `/epic`, Command Center | RPC handlers |
| Agent | `epic_*` MCP tools | the MCP server, in-process core |
| Plugin itself | `before agent.create` hook | epic detection |

The plugin writes nothing into the user's repo except the files the routine
already owns: the epic folder, and the optional `.epic.yml` the user adds
by hand.

### Epic detection

A workspace is "in an epic" when its repo root has `epicsDir` (default
`docs/stories/epics`) containing at least one `EPIC.md` with the
`epic-status` markers. Detection decides whether the MCP server is injected
and whether the panel shows content. Detection reads the file system once
per check; it does not watch.

## 4. The files the plugin owns in a repo

Unchanged from the skill. Three parts of `EPIC.md` are machine-read:

- the Status block between `<!-- epic-status:begin -->` and
  `<!-- epic-status:end -->`, rendered from the table, never typed;
- the story table under `## Story list`: row order is the build order, the
  first cell starts with the story id, columns are Story, Description, Lane,
  Status, Done; Status is one of `planned`, `in_progress`, `implemented`,
  `dropped`; Done is `YYYY-MM-DD PR #N`;
- the ledger under `## Ledger`: one `### <id> — YYYY-MM-DD` entry per
  finished story, appended, newest last, with five fixed bullets: Branch /
  PR, Shipped, Decisions, Deviations, Effects on later stories.

`HANDOFF.md` is rewritten whole at every close. Its header is
`<!-- handoff: epic=<E> after=<id|none> next=<id|none> written=YYYY-MM-DD -->`
and it has five numbered headings: epic state, last story, plan changes,
next story brief, gotchas.

Story ids match `^[A-Z]{2,}-\d+$`. Epic ids match `^E\d+$`. The epic branch
is `epic/<Eid>-<slug>`; story branches are `<branchPrefix><id>-<slug>`.

## 5. The core (server/core)

A TypeScript port of `scripts/epic.py`, behaviour for behaviour. Git and
`gh` run as child processes with no shell. The 17 Python tests become the
first vitest cases.

| Operation | Does | Refuses when |
| --- | --- | --- |
| `parse` | Reads both files into typed records. | never, returns problems |
| `check` | The lint rules: H1 id matches folder; Status keys present and equal to what the table implies; row statuses valid; implemented rows have Done and a ledger entry; ledger entries map to implemented rows with valid dates; handoff header `epic=`, `after=` last ledger entry, `next=` first open row, `written=` a date; five headings present. | lists problems |
| `render` | Rewrites the Status block from the table. | markers missing |
| `init` | Creates `epic/<E>-<slug>` from a base ref, writes both files from templates. | dirty tree, `EPIC.md` exists |
| `start` | Fetches, reads the package from `origin/<epic branch>`, runs `check`, resolves the next open story, cuts `<prefix><id>-<slug>` from the tip or resumes it, returns the handoff text. | check fails; asked story is not next; handoff `next=` mismatch; an open PR still targets the epic branch; no remote branch; dirty tree |
| `close` | Renders, runs `check` plus three close rules (row implemented, last ledger entry is this story, handoff `after=` is this story), commits the epic folder, pushes, opens the PR with the ledger entry as body; opens a draft epic PR to the base when no open rows remain. | not ready; uncommitted changes outside the epic folder; current branch is not the story branch |
| `next` | Fetches, reads the merged tip, requires the closed story to be the last ledger entry, finds the merged PR and its conversation comments, computes the next story and branch. | not merged; closed earlier than the last entry; check fails |
| `status` | Read-only summary for the panel: ids, branch, commits behind base, counts, next, open PR, last check result. | never |

Without `gh`, PR steps return the instructions to do by hand. Nothing is
silent.

### `.epic.yml` (optional, in the user's repo)

```yaml
epicsDir: docs/stories/epics        # default
templates: docs/templates           # folder with epic.md and handoff.md overrides
branchPrefix: feat/                 # story branch prefix
baseBranch: main                    # where the epic branch is cut from and merges to
profile: story                      # Paseo launch profile for successor agents
hooks:
  start:                            # lines quoted to the agent after start
    - "Run scripts/bin/harness-cli query matrix before any edit."
  close:                            # lines quoted to the agent before close
    - "Accept ADRs scoped inside the story."
  nextPrompt: |                     # appended to the successor agent's prompt
    Write the plan and stop for approval before the intake gate.
```

The plugin never executes anything from this file. A shared repo cannot
make the daemon run a command through it.

## 6. The agent side (server/mcp and the create hook)

The `before agent.create` hook adds an MCP server named `epic` to every
agent whose workspace is in an epic. The server is a stdio process shipped
in the plugin, started with the repo root as an argument, using the core
in-process.

| Tool | Input | Returns |
| --- | --- | --- |
| `epic_status` | none | the `status` record |
| `epic_start` | story id | the handoff text from the merged tip, plus `.epic.yml` start hook lines |
| `epic_close_check` | story id | the close problem list, or "ready" |
| `epic_close` | story id | PR link and the waiting text |
| `epic_next` | closed story id | the `next` record plus the new agent name |
| `epic_check` | epic id | lint result |

Every tool answer ends with a short "what to do now" paragraph. This is the
routine's prose, moved from `SKILL.md` into the plugin. Examples:

After `epic_start`:

```
This handoff is your context. Read the files under "Read first" and the
story packet. Do not re-read the whole EPIC.md unless the handoff sends you
there. <start hook lines>
```

After `epic_close_check` with problems:

```
Fix these, then call epic_close_check again. The ledger entry has five
bullets: Branch / PR, Shipped, Decisions, Deviations, Effects on later
stories. HANDOFF.md is rewritten whole with headings 1 to 5.
```

After `epic_close`:

```
PR #274 opened: <link>. Tell the user to merge it, then reply `next`.
Stay in this session. Do not build the next story here.
```

After `epic_next` when the PR is merged:

```
Started agent "TH-667 Procedure reads" in worktree feat/TH-667-procedure-
reads. It will read the handoff and stop for plan approval. This session
is finished.
```

Writing the ledger entry and the handoff stays with the agent. It uses its
normal file tools, then calls `epic_close_check` until clean, then
`epic_close`.

`epic_next` performs the spawn itself through the daemon SDK (section 8),
so the agent never calls Paseo tools. Codex and Claude agents get the same
flow.

Implementation note (2026-10-01): epic_next reports "Spawn pending"; the plugin's agent.turn_ended hook performs the spawn, since the MCP process has no daemon SDK.

## 7. The human side (client)

### Epic panel

`addWorkspacePanel`, workspace context, shown only when the workspace is in
an epic. React Native primitives, theme colors, compact layout.

```
 E100 — Sidera                 branch epic/E100-sidera   3 behind main
 State in_progress   Stories 2 of 6   Next TH-666

 Story               Lane       Status        Done
 TH-664 Manifest     normal     implemented   2026-09-30 PR #272
 TH-665 Engine role  high-risk  implemented   2026-09-30 PR #273
 TH-666 Streaming    normal     in_progress

 Open PR: #276 (waiting for merge)   [ Check ]   [ Start next story ]
 Last check: ok
```

- **Start next story** runs `next` for the last closed story. Not merged:
  shows the open PR link and "waiting for merge". Merged: creates the
  worktree and the agent, shows the agent name.
- **Check** runs the lint and shows problems inline.
- The panel reads `status` when opened and after a button press. No timer.

### Slash command

`/epic <verb> [id]`, workspace context. Verbs: `init`, `start`, `close`,
`next`, `check`, `status`.

- `start` and `close` send the agent in the current workspace its
  instructions as a prompt; the agent then calls the MCP tools.
- `next`, `check`, `status`, `init` run the RPC directly and show the
  result in the panel.

### Command Center

"Epic: start next story", workspace context. Same RPC as the button.

### Trigger summary

| Who | How | What happens |
| --- | --- | --- |
| Human merges on GitHub | the gate | nothing, by design |
| Human replies `next` to the closing agent | agent calls `epic_next` | successor spawned |
| Human presses the panel button | RPC `next` | successor spawned |

## 8. The `next` spawn

Shared by the RPC and the MCP tool.

1. Run core `next` for the closed story. Stop with its message if it refuses.
2. If `next.story` is null, return "epic closed" with what remains for the
   epic PR.
3. Idempotency: if a local branch `next.branch` exists, or a Paseo workspace
   already has that branch checked out, reuse it. Never create twice.
4. Create the workspace through the daemon SDK: worktree, branch-off from
   `origin/<epic branch>`, new branch `next.branch`.
5. Pick the launch profile: the profile named in `.epic.yml`
   (`profile: story`) if present, else the first profile whose notes mention
   "story" or "epic", else the daemon default. Materialize it into the agent
   config.
6. Create the agent in that workspace with this prompt:

```
/epic start <next.story>

Answers from PR #<n> (conversation comments, oldest first):
- <author>, <date>: <body>
(or: none)

<.epic.yml nextPrompt, if any>
```

   The `/epic start` line is a plain instruction here; the agent reads it
   and calls the `epic_start` tool.
7. Return the record below.

```json
{
  "epic": "E100",
  "epicBranch": "epic/E100-sidera",
  "closed": {
    "story": "TH-666",
    "pr": { "number": 276, "url": "https://github.com/o/r/pull/276", "mergedAt": "2026-10-01T09:00:00Z" },
    "comments": [{ "author": "someone", "createdAt": "2026-10-01T08:30:00Z", "body": "Q3: use the mirror rule." }]
  },
  "next": {
    "story": "TH-667", "title": "Procedure reads", "lane": "high-risk",
    "branch": "feat/TH-667-procedure-reads", "baseRef": "origin/epic/E100-sidera"
  },
  "spawned": { "workspaceId": "ws_x", "agentId": "ag_y", "title": "TH-667 Procedure reads" }
}
```

Only conversation comments go forward. Review comments on code lines
belonged to the merged story.

## 9. Repo layout

```
paseo-epic/
  paseo-plugin.json          id "epic", requirements.paseo ">=0.10.0"
  package.json               @<scope>/paseo-epic, files list, scripts: typecheck, test
  tsconfig.json              from `paseo plugin init`, no DOM lib
  index.client.tsx           panel, slash command, Command Center item
  index.server.ts            RPC handlers, before agent.create hook, settings
  shared/                    zod contracts: status, init, start, close, next, check
  server/core/               parse, check, render, git, gh, config, templates
  server/rpc/                thin handlers over core and the SDK
  server/mcp/                stdio MCP server exposing core to agents
  templates/                 epic.md, handoff.md defaults
  client/                    EpicPanel.tsx and small pieces
  test/                      vitest: core, git flow on a bare remote, mcp, next with a fake SDK
  docs/
    README.md                what it is, single-user note, install, .epic.yml
    routine.md               the routine prose, same text the tools quote
    superpowers/specs/       this file
```

## 10. Testing

- Core unit tests ported from `scripts/tests/test_epic.py`: parse and check
  rules, render stability, find by story id.
- Git flow tests against a temporary bare remote: start reads the handoff
  from the remote tip and guards the story; start refuses a broken remote
  package and a missing remote branch; close checks then commits the
  folder; close refuses uncommitted story work and the wrong branch; next
  refuses before the merge; next reports the next story after the merge;
  next reports a closed epic.
- MCP server: spawn it, list tools, call `epic_status` and `epic_check`
  over stdio.
- `next` spawn: the handler takes the SDK as a dependency; a fake records
  the workspace and agent calls; assert prompt text, branch, base ref, and
  idempotency on a second call.
- Manual, per the Paseo plugin skill: `npm run typecheck`, install, `paseo
  plugin ls` shows `running`, panel on a wide window and compact layout in
  two themes, `/epic` offered in the composer, an agent in an epic
  workspace lists the `epic_*` tools.

## 11. Errors

- Every refusal is one sentence that says what to do next.
- Tools return refusals as text. RPCs throw typed errors. The panel shows
  them inline, never as a toast only.
- `gh` missing: PR steps print the manual command.
- Daemon SDK failure during `next`: the branch and workspace checks in
  section 8 make a retry safe.
- Plugin logs go to the plugin stdout and stderr. No secrets in logs.

## 12. Release and install

- Publish under the user's npm scope. Install with
  `paseo plugin install npm:@<scope>/paseo-epic` or
  `paseo plugin install github:<owner>/paseo-epic`.
- `requirements.paseo` starts at `>=0.10.0` and rises only when a newer
  plugin API is adopted.
- The plugin needs `pluginsEnabled: true` on the daemon. The README repeats
  Paseo's trust warning: plugins are unsandboxed code on the daemon machine.

## 13. Migration of inflow (after the plugin works)

1. Install the plugin on the daemon; enable plugins once, with permission.
2. Add `.epic.yml` to inflow: intake gate, ADR rule, and plan rule as hook
   text; `profile: story`.
3. Delete `.claude/skills/epic/`, `scripts/epic.py`, `scripts/tests/test_epic.py`
   from inflow. Keep `docs/templates/epic.md` and `handoff.md` as overrides.
4. Point `docs/HARNESS.md` and `CLAUDE.md` at the plugin.
5. E100 continues: the files are the same, only the caller moves.

## 14. Facts to verify at plan time

These come from docs that did not show the exact shapes. The plan reads the
installed SDK types (`node_modules/@getpaseo/plugin`) and fixes them before
code is written.

- The `workspaces.create` option names for a worktree branch-off: cwd,
  action, base ref, new branch name, slug.
- Whether the SDK exposes agent profiles to plugins, and under which call.
  If not, `.epic.yml` `profile` becomes an inline provider/mode setting.
- The `config.mcpServers` entry shape for a stdio server (command, args,
  env) in the `before agent.create` hook.
- Whether `agent.create` config accepts `labels` and `title` for the
  successor agent.
- The CLI on the daemon machine is 0.3.1 and has no `paseo plugin` command;
  `@getpaseo/cli` 0.10.2 is on npm and matches the daemon. Upgrade before
  `paseo plugin init`.
- `pluginsEnabled` is absent in the daemon config. Enabling it is the user's
  action.
