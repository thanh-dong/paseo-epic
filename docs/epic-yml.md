# `.epic.yml`

`.epic.yml` is an optional file at the root of your repo. Without it, the
plugin uses the defaults below.

**The plugin never executes anything from this file.** It only reads the
values and quotes the hook text to agents. A shared repo cannot make the
daemon run a command through it.

The schema is strict. An unknown key, at the root or under `hooks`, is an
error. So is a wrong type or a YAML syntax error. With a bad file:

- the tools, the panel and `/epic` report an error that starts with
  `.epic.yml:` and names the key when there is one;
- new agents do not get the `epic` MCP server; the plugin log
  (`paseo plugin logs epic`) says why.

## Fields

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `epicsDir` | string | `docs/stories/epics` | The folder, relative to the repo root, that holds one folder per epic package (`E1-<slug>/EPIC.md`, `HANDOFF.md`). Epic detection looks here. |
| `templates` | string | none (the shipped templates) | A folder, relative to the repo root, with your own `epic.md` and `handoff.md`. `init` uses a file from it when the file exists, else the shipped one. |
| `branchPrefix` | string | `feat/` | The prefix of story branches: `<branchPrefix><story>-<slug>`. `next` also uses it to find the merged story PR by its head branch. |
| `baseBranch` | string | `main` | The branch `init` cuts the epic branch from (`origin/<baseBranch>`), and the base of the draft epic PR. The panel shows how many commits the epic branch is behind it. |
| `profile` | string | none | The Paseo launch profile for successor agents, matched by profile id or name. Without it, the first profile whose notes mention "story" or "epic"; without that, a plain `claude` agent. |
| `hooks.start` | list of strings | `[]` | Lines added to the "what to do now" text after `epic_start`. |
| `hooks.close` | list of strings | `[]` | Lines for the agent before close. `epic_close_check` quotes them after its "what to do now" paragraph, one per line, whether the package is ready or not. |
| `hooks.nextPrompt` | string | none | Text appended to the successor agent's first prompt, after the PR comments. |

## Full example

```yaml
epicsDir: docs/stories/epics        # default
templates: docs/templates           # folder with epic.md and handoff.md overrides
branchPrefix: feat/                 # story branch prefix
baseBranch: main                    # where the epic branch is cut from and merges to
profile: story                      # Paseo launch profile for successor agents
hooks:
  start:                            # lines quoted to the agent after start
    - "Run scripts/bin/harness-cli query matrix before any edit."
  close:                            # lines quoted by epic_close_check
    - "Accept ADRs scoped inside the story."
  nextPrompt: |                     # appended to the successor agent's prompt
    Write the plan and stop for approval before the intake gate.
```

The `start` line above is only text for the agent. The plugin does not run
`harness-cli`; the agent reads the line and decides.
