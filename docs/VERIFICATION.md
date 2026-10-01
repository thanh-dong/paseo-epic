# Manual verification

The manual checks from spec section 10, for the first install on the user's
daemon. Each row gets a result and a date when it is run. Nothing here has
been run yet.

## How to run

Before you start: plugins must be enabled on the daemon (`pluginsEnabled:
true`, see "Enable plugins" in [README.md](README.md)). Enabling them is the
user's decision. Ask first, with Paseo's trust warning.

Install the plugin from this clone and check that it runs:

```bash
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
| 1 | `npm run typecheck` | no errors | pending | |
| 2 | `paseo plugin install` (command above) | install succeeds | pending | |
| 3 | `paseo plugin ls` | `epic` is `running`, no error | pending | |
| 4 | `paseo plugin logs epic` | no error in the logs | pending | |
| 5 | Epic panel, wide window | shows E100 with its story rows and the next story | pending | |
| 6 | Epic panel, compact layout | rows stack, text is readable | pending | |
| 7 | Epic panel, a second theme | text is readable in both themes | pending | |
| 8 | `/epic status` | opens the Epic panel | pending | |
| 9 | `/epic` in the composer | autocomplete offers the command | pending | |
| 10 | New agent in the E100 workspace | it lists the `epic_*` tools, including `epic_status` and `epic_check` | pending | |
| 11 | Ask that agent to call `epic_status` | it returns the E100 record and a "what to do now" line | pending | |

## After the checks pass: move inflow to the plugin

From spec section 13. Do this only after every row above passes.

1. Install the plugin on the daemon; enable plugins once, with permission.
2. Add `.epic.yml` to inflow: the intake gate, the ADR rule, and the plan
   rule as hook text; `profile: story`. Note: the ADR rule belongs to close,
   and `hooks.close` is not quoted yet (see Limitations in
   [README.md](README.md)).
3. Delete `.claude/skills/epic/`, `scripts/epic.py`, and
   `scripts/tests/test_epic.py` from inflow. Keep `docs/templates/epic.md`
   and `handoff.md` as overrides.
4. Point `docs/HARNESS.md` and `CLAUDE.md` at the plugin.
5. E100 continues: the files are the same, only the caller moves.
