# paseo-epic

This plugin is for **one person running a whole epic on one daemon**. One
story is in flight at a time, one agent builds it, one human merges. It is
not a tool for several members sharing one epic. The design assumes a single
actor everywhere: no locks, no assignment, no per-member state.

## What it is

An epic is a planned list of user stories. You build them in order, on one
branch. What you learn in one story changes the plan for the next one.

`paseo-epic` is a native Paseo plugin (plugin id `epic`). It keeps this
chain short and honest:

- One file carries the plan and the history: `EPIC.md`.
- One file carries the brief for the next story: `HANDOFF.md`.
- A fresh agent starts every story from the merged handoff.
- The human gate is the pull request merge. After the merge you take one
  action: reply `next` to the closing agent, or press a button in Paseo.

The plugin gives you:

- An **Epic** workspace panel: the epic, its story table, the next story,
  the open PR, and two buttons: **Check** and **Start next story**.
- A `/epic <verb> [id]` slash command. Verbs: `init`, `start`, `close`,
  `next`, `check`, `status`.
- A Command Center item: **Epic: start next story**.
- An `epic` MCP server with six tools. The plugin adds it to every agent
  created in an epic workspace.

A workspace is "in an epic" when its repo root has the `epicsDir` folder
(default `docs/stories/epics`) and some package folder in it has an
`EPIC.md` with the `<!-- epic-status:begin -->` marker.

```
  you (Paseo app)                 plugin (daemon)            agent
  +-------------------+          +-----------------+        +-----------+
  | Epic panel        |  RPC     | core:           |  MCP   | epic_*    |
  | /epic             | -------> | EPIC.md,        | <----- | tools     |
  | Command Center    |          | HANDOFF.md,     |        |           |
  +-------------------+          | git, gh         |        +-----------+
                                 +-----------------+
```

## Install

You need Paseo 0.10.2 or newer (`paseo-plugin.json` says
`"paseo": ">=0.10.2"`).

From GitHub:

```bash
paseo plugin install github:<owner>/paseo-epic
```

From npm, once the package is published under your scope (today it is
`private` and has no scope):

```bash
paseo plugin install npm:@<scope>/paseo-epic
```

From a local clone:

```bash
paseo plugin install /absolute/path/to/paseo-epic
```

Then check that it runs:

```bash
paseo plugin ls          # epic must show `running`
paseo plugin logs epic   # no errors
```

A `paseo` CLI older than 0.10 has no `paseo plugin` command. You do not need
a global upgrade. Run the 0.10.2 CLI through `npx`:

```bash
npx -y @getpaseo/cli@0.10.2 plugin install github:<owner>/paseo-epic
```

For a GitHub install, Paseo runs the build steps from `paseo-plugin.json`:
`npm ci`, then `npm run build:mcp`. The built MCP server
(`mcp/epic-mcp.mjs`) is also committed, so a local clone works as is.

The MCP server runs under plain `node`. The plugin uses `PASEO_EPIC_NODE`
when it is set in the daemon's environment, else `node` on `PATH`, else the
daemon's own executable with `ELECTRON_RUN_AS_NODE=1`.

## Enable plugins

The daemon runs plugins only when `pluginsEnabled` is `true`. A missing key
counts as `false`. Turn it on in one of two ways:

- In the Paseo app: **Settings → Plugins → Enable plugins**.
- Or set the root key `"pluginsEnabled": true` in the daemon's
  `config.json`, then run `paseo reload --json`.

Read Paseo's warning before you do this:

> Plugins are trusted, unsandboxed code. Backend plugin code can access your
> daemon machine, including files, processes, credentials, and network
> services. Client plugin code runs inside the Paseo app.

Install only plugins whose source you have read.

## The routine in five lines

1. **init**: `/epic init E1 "Title"` creates the branch `epic/E1-<slug>` and
   writes `EPIC.md` and `HANDOFF.md`. You plan the stories, then commit and
   push the epic branch.
2. **start**: `/epic start <story>` tells the agent to call `epic_start`. It
   cuts the story branch from the epic tip and returns the handoff.
3. **build**: the agent builds the story as an ordinary task, in any way you
   like.
4. **close**: `/epic close <story>`. The agent updates the story row, the
   ledger, and `HANDOFF.md`, calls `epic_close_check` until it is ready, then
   `epic_close`. That commits, pushes, and opens the story PR.
5. **next**: you merge the PR, then reply `next` to the closing agent or
   press **Start next story**. The plugin starts a fresh agent for the next
   story in a new worktree.

The full text the tools give the agent is in [routine.md](routine.md).

## The `next` flow

| Who | How | What happens |
| --- | --- | --- |
| Human merges on GitHub | the gate | nothing, by design |
| Human replies `next` to the closing agent | agent calls `epic_next` | successor spawned |
| Human presses the panel button | RPC `next` | successor spawned |

The `/epic next [story]` command and the Command Center item **Epic: start
next story** use the same RPC as the panel button.

**How the agent path spawns.** The MCP server has no access to the daemon
SDK, so `epic_next` cannot start an agent itself. It does two things:

1. It confirms the merge and names the next story.
2. It ends its answer with the line
   `Spawn pending for <next story>: the plugin starts the successor now.`

When the agent's turn ends normally, the plugin sees that line (hook
`agent.turn_ended`). It then creates the worktree and the agent, and sends
the result to the closing agent as a message. If the turn does not end
normally (for example, you cancel it), nothing is spawned. Press **Start
next story** instead.

```
  you: "next"
      |
      v
  closing agent --epic_next--> "Spawn pending for TH-2"
      |
      v  turn ends
  plugin hook --> new worktree feat/TH-2-<slug> + new agent
      |
      v
  closing agent gets: Started agent "TH-2 <title>" ...
```

The spawn is safe to repeat. If a Paseo workspace already has the next
story's branch checked out, the plugin starts nothing new and tells you
where it is.

The new agent's first prompt is `/epic start <story>`, then the
conversation comments from the merged story PR (oldest first), then the
`hooks.nextPrompt` text from `.epic.yml`.

The new agent uses the launch profile named by `.epic.yml` `profile` (by id
or name). Without one, it uses the first profile whose notes mention "story"
or "epic". Without such a profile, it is a plain `claude` agent.

## `.epic.yml`

An optional file at the repo root. It changes folders, branch names, the
launch profile, and adds text for the agent. The plugin never executes
anything from it. See [epic-yml.md](epic-yml.md).

## Agent tools

The `epic` MCP server gives agents these six tools. Each answer is the
result as JSON, then a short "what to do now" paragraph.

- `epic_status` (no input): the epic package this repo is on: state, story
  rows, next story, problems.
- `epic_start` (`story`): cuts the story branch from the epic tip and returns
  the handoff, plus the `.epic.yml` `hooks.start` lines.
- `epic_close_check` (`story`): lists what still stops the story from
  closing.
- `epic_close` (`story`): commits the epic folder, pushes, and opens the
  story PR.
- `epic_next` (`story`, the closed story): confirms the merge and names the
  next story; the plugin then spawns it (see above).
- `epic_check` (`epic`, optional): lints one epic package, or every package
  when no epic id is given.

A refusal comes back as an error result with one sentence that says what to
do next.

## Out of scope

- Several people sharing one epic.
- Background polling of pull requests. The human merges and triggers.
- GitHub stacked pull requests.
- Paseo Hub triggers or any webhook path.
- A default method for building a story. Between `start` and `close` the
  agent works however the user likes. `.epic.yml` can add text, not rules.
- Running commands from `.epic.yml`. The plugin only quotes its text.

## Limitations

- `.epic.yml` `hooks.close` lines are not quoted to the agent yet. This is
  planned for the next release. `hooks.start` and `hooks.nextPrompt` are
  quoted today.
- Without the `gh` CLI, the plugin does not open PRs or read PR comments.
  `epic_close` returns the commands to run by hand, and `next` says the PR
  comments were not read.
- The panel reads the package when it opens, after a button press, and after
  an `/epic` command result. It does not refresh on a timer.
- The npm package is not published yet.
