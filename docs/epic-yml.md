# `.epic.yml`

`.epic.yml` is an optional file at the root of your repo. Without it, the
plugin uses the defaults below.

Its presence alone matters too: a new agent in a repo with `.epic.yml` gets
the `epic` MCP server even before any epic exists, so a planning agent can
create the first epic with `epic_init`. Tools are added when an agent is
created, so an agent created before you added the file must be replaced by a
new one.

**The plugin never executes anything from this file.** It only reads the
values and quotes the hook text to agents. A shared repo cannot make the
daemon run a command through it.

The plugin runs the flow; your repo owns the rules. The plugin checks no
story ids and no file content. If your repo has rules (an id format, a
ledger format, a script that checks the package), write them as hook lines
here. The agent reads the lines at the right moment and follows them.

The schema is strict. An unknown key, at the root or under `hooks`, is an
error. So is a wrong type or a YAML syntax error. With a bad file:

- the tools, the panel and the `/epic` command report an error that starts
  with `.epic.yml:` and names the key when there is one;
- new agents do not get the `epic` MCP server; the plugin log
  (`paseo plugin logs epic`) says why.

An older plugin does not know `hooks.init` and `epicBranchPrefix`. Because
the schema is strict, it refuses a file that has them. Add them only after
this version is installed.

## Fields

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `epicsDir` | string | `docs/stories/epics` | The folder, relative to the repo root, that holds one folder per epic package (`<epic>-<slug>/EPIC.md`, `HANDOFF.md`). Epic detection looks here. |
| `templates` | string | none (the shipped templates) | A folder, relative to the repo root, with your own `epic.md` and `handoff.md`. `epic_init` uses a file from it when the file exists, else the shipped one. |
| `branchPrefix` | string | `feat/` | The prefix of story branches: `<branchPrefix><story>-<slug>`. `next` also uses it to find the merged story PR by its head branch. |
| `epicBranchPrefix` | string | `epic/` | The prefix of the epic branch: `<epicBranchPrefix><epic folder>`. `epic_init` cuts it, and every other step uses it. The `Branch:` line in the Status block is for display only. |
| `baseBranch` | string | `main` | The branch `epic_init` cuts the epic branch from (`origin/<baseBranch>`), and the base of the draft epic PR. The panel shows how many commits the epic branch is behind it. |
| `profile` | string | none | The Paseo launch profile for successor agents, matched by profile id or name. Without it, the first profile whose notes mention "story" or "epic"; without that, a `claude` agent on the provider's default model (`providers.listModels`); a profile with no model gets its provider's default too. |
| `hooks.init` | list of strings | `[]` | Lines quoted after `epic_init`, one per line, between "fill EPIC.md and HANDOFF.md" and "commit and push the epic branch". |
| `hooks.start` | list of strings | `[]` | Lines added to the "what to do now" text after `epic_start`. |
| `hooks.close` | list of strings | `[]` | The close steps. `epic_start` quotes them under "When the story is done:", one per line, before "Call epic_close with `<story>`". The client's `/epic close` prompt quotes them too (it gets them from the status RPC). |
| `hooks.nextPrompt` | string | none | Text appended to the successor agent's first prompt, after the PR comments. |

## Full example

```yaml
epicsDir: docs/stories/epics        # default
templates: docs/templates           # folder with epic.md and handoff.md overrides
branchPrefix: feat/                 # story branch prefix
epicBranchPrefix: epic/             # epic branch prefix
baseBranch: main                    # where the epic branch is cut from and merges to
profile: story                      # Paseo launch profile for successor agents
hooks:
  init:                             # lines quoted after epic_init
    - "Name the stories with ids from scripts/next-id.sh."
  start:                            # lines quoted after epic_start
    - "Read CONTRIBUTING.md before any edit."
  close:                            # the close steps, quoted by epic_start
    - "Set the story row to done and add its ledger entry."
    - "Run scripts/check-epic.sh and fix what it reports."
  nextPrompt: |                     # appended to the successor agent's prompt
    Write the plan and stop for approval.
```

The script names above are only text for the agent. The plugin does not run
them; the agent reads the lines and decides.
