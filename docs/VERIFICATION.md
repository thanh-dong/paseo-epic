# Manual verification

The manual checks from spec section 10, for the first install on the user's
daemon. Each row gets a result and a date when it is run. Rows marked pass were run on
2026-10-01 on the author's Mac mini daemon (Paseo 0.10.2).

## How to run

Before you start: plugins must be enabled on the daemon (`pluginsEnabled:
true`, see "Enable plugins" in [README.md](README.md)). Enabling them is the
user's decision. Ask first, with Paseo's trust warning.

Install the runtime dependencies in the clone first (a local-path install
does not run the build steps, and the server bundle needs `yaml` from
`node_modules`), then install the plugin from this clone and check that it
runs:

```bash
(cd /Volumes/ExDrive/_sources/paseo-epic && npm ci --omit=dev)
npx -y @getpaseo/cli@0.10.2 plugin install /Volumes/ExDrive/_sources/paseo-epic
npx -y @getpaseo/cli@0.10.2 plugin ls
npx -y @getpaseo/cli@0.10.2 plugin logs epic
```

Expected: `epic` is `running`, and the logs show no error.

Then open the Paseo app, in the inflow E100 worktree workspace, and work
through the table.

## Checklist

| # | Check | Expected | Result | Date |
| --- | --- | --- | --- | --- |
| 1 | `npm run typecheck` | no errors | pass | 2026-10-01 |
| 2 | `paseo plugin install` (command above) | install succeeds | pass (local path, node_modules already present) | 2026-10-01 |
| 3 | `paseo plugin ls` | `epic` is `running`, no error | pass | 2026-10-01 |
| 4 | `paseo plugin logs epic` | no error in the logs | pass ("Loading plugin", "Plugin ready", nothing else) | 2026-10-01 |
| 5 | Epic panel, wide window | shows E100 with its story rows and the next story | pending | |
| 6 | Epic panel, compact layout | rows stack, text is readable | pending | |
| 7 | Epic panel, a second theme | text is readable in both themes | pending | |
| 8 | `/epic status` | opens the Epic panel | pending | |
| 9 | `/epic` in the composer | autocomplete offers the command | pending | |
| 10 | New agent in the E100 workspace | it lists the `epic_*` tools, including `epic_status` and `epic_check` | pass (Haiku 4.5 agent listed epic_check, epic_status, epic_close_check, epic_close, epic_next, epic_start) | 2026-10-01 |
| 11 | Ask that agent to call `epic_status` | it returns the E100 record and a "what to do now" line | pass (E100 record, 4 of 6, next TH-668, "The next open story is TH-668…") | 2026-10-01 |
| 12 | `paseo plugin logs epic` after install | no "Cannot find module 'zod'" (Paseo supplies `zod` to the bundle) | pass (no missing-module error at load; status and check answered) | 2026-10-01 |
| 13 | Local-path install after `npm ci --omit=dev` in the clone | `paseo plugin ls` shows `epic` as `running` | pass (install from the clone with node_modules present; npm ci --omit=dev not exercised) | 2026-10-01 |
| 14 | New agent, daemon with `node` on `PATH` | the `epic` MCP server starts with the `which node` path; its tools are listed | pass (node on PATH at ~/.nvm/…/v20.19.4/bin/node; bundle materialized under $TMPDIR/paseo-epic/) | 2026-10-01 |
| 15 | New agent, daemon with no `node` on `PATH` (and no `PASEO_EPIC_NODE`) | the server starts through the daemon executable with `ELECTRON_RUN_AS_NODE=1`; its tools are listed | pending | |
| 16 | Row 15, in the agent's MCP server process | the provider merged the MCP `env` (`ELECTRON_RUN_AS_NODE=1` is set) | pending | |
| 17 | New Codex agent in the E100 workspace | it also lists the `epic_*` tools | pending | |
| 18 | Branch-off for a successor | Paseo accepts `baseBranch: origin/epic/…` (a remote ref) and cuts the story branch from it | pending | |
| 19 | Reply `next` to a closing agent after the story PR merged | the `agent.turn_ended` hook spawns the successor after `epic_next`, and the closing agent gets `Started agent ...` | pending | |
| 20 | Reply `next` again, or press **Start next story**, right after row 19 | `gitRuntime.currentBranch` of the new workspace is already filled, so the plugin finds it and starts no second agent | pending | |
| 21 | Epic panel with a story in progress in its own worktree: run it once from a checkout on the epic branch and once from a checkout on `main`, and record what happens in each | from the epic branch, the `in_progress` row starts open and lists the worktree's changed files, not the checkout's; from `main`, record whether the epic shows or the row refuses with `no epic package lists <story> in this checkout; ...` | pending | |
| 22 | Press **Open workspace** in that row | the app lands in the story's worktree workspace; record what `navigation.openWorkspace` does (switches to the workspace, or only selects it in the sidebar) | pending | |
| 23 | Compare the row's file list with `git status --porcelain --untracked-files=all` and `git diff --name-status origin/<epic>...HEAD` run in the worktree | the same files, the same status letters after the merge rules (new or renamed files keep A or R; a new file deleted again disappears), and the `uncommitted` tag on exactly the uncommitted and untracked ones | pending | |
| 24 | Press **Open agent** in that row | the app opens the story's agent | pending | |
| 25 | An open story row in the compact layout and in a second theme | the row and its file lines stay readable; long paths keep their end visible; the status dot is visible in both themes | pending | |

## After the checks pass: move inflow to the plugin

From spec section 13. Do this only after every row above passes.

1. Install the plugin on the daemon; enable plugins once, with permission.
2. Add `.epic.yml` to inflow: the intake gate, the ADR rule, and the plan
   rule as hook text; `profile: story`. The ADR rule belongs to close:
   put it under `hooks.close`, which `epic_close_check` quotes.
3. Delete `.claude/skills/epic/`, `scripts/epic.py`, and
   `scripts/tests/test_epic.py` from inflow. Keep `docs/templates/epic.md`
   and `handoff.md` as overrides.
4. Point `docs/HARNESS.md` and `CLAUDE.md` at the plugin.
5. E100 continues: the files are the same, only the caller moves.
