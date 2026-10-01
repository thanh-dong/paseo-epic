# The routine

This page is the routine in prose. Where a tool or command gives the agent
text, this page quotes that text exactly, as it is written in
`server/core/text.ts`, `client/strings.ts` and `server/mcp/main.ts`. Words in
angle brackets (`<story>`) are filled in at run time.

Every tool answer is the result as JSON, a blank line, then the "what to do
now" text below. A refusal is an error result with one sentence that says
what to do next.

```
  init --> start --> build --> close --> (you merge) --> next
             ^                                            |
             +------------- fresh agent, next story ------+
```

## init

`/epic init <epic> "<title>"`, for example `/epic init E1 "Search"`.

- The epic id looks like `E1`. The title is the rest of the line; quotes are
  optional.
- The working tree must be clean.
- The plugin fetches `origin` and checks out the epic branch
  `epic/<epic>-<slug>`. It reuses the branch when it exists locally or on
  `origin`. Otherwise it creates the branch from `origin/<baseBranch>`.
- It writes `EPIC.md` and `HANDOFF.md` into `<epicsDir>/<epic>-<slug>/`, from
  the templates (yours from `.epic.yml` `templates`, else the shipped ones).
- It refuses when `EPIC.md` already exists.
- It does not commit or push. You fill in the story list and the first
  handoff, then commit and push the epic branch. `start` and `next` read the
  package from `origin/<epic branch>`.

## start

`/epic start <story>` sends the newest open agent in the workspace this
prompt:

```
Start story <story>: call the epic_start tool with <story>. It cuts the story branch from the epic tip and returns the handoff. Read the handoff and the files it lists, then build the story as an ordinary task.
```

`epic_start` fetches `origin`, reads the package from `origin/<epic branch>`
(never from the working copy), and runs `check`. It cuts
`<branchPrefix><story>-<slug>` from that tip, or resumes the branch if it
exists. It refuses when:

- the working tree is dirty;
- `origin/<epic branch>` does not exist;
- the package on the tip fails `check`;
- the epic has no open story;
- the story asked for is not the next open story;
- the `HANDOFF.md` header `next=` is not that story;
- with `gh`: an open PR still targets the epic branch (one story in
  flight). Without `gh`, this is not checked, and the result carries a
  warning that says so.

After `epic_start`, the agent reads:

```
This handoff is your context. Read the files under "Read first" and the story packet. Do not re-read the whole EPIC.md unless the handoff sends you there. <hooks.start lines>
```

Between `start` and `close` the agent builds the story however you like.
The plugin adds no method.

## close

`/epic close <story>` sends the newest open agent in the workspace:

```
Close story <story>. Update the epic package by hand: set the <story> row to `implemented` with Done `YYYY-MM-DD PR #n` (`PR pending` while the number is not known); append the ledger entry `### <story> — YYYY-MM-DD` with five bullets: Branch / PR, Shipped, Decisions, Deviations, Effects on later stories; rewrite HANDOFF.md whole with headings 1 to 5 and the header `after=<story>`. Then call epic_close_check with <story> until it reports ready, and call epic_close with <story>.
```

The `.epic.yml` `hooks.close` lines are not added to this prompt yet; see
Limitations in [README.md](README.md).

The agent writes these by hand with its normal file tools:

- The story row: Status `implemented`, Done `YYYY-MM-DD PR #n`.
- The ledger entry `### <story> — YYYY-MM-DD` under `## Ledger`, appended,
  newest last, with five bullets:
  1. Branch / PR
  2. Shipped
  3. Decisions
  4. Deviations
  5. Effects on later stories
- `HANDOFF.md`, rewritten whole. Its header is
  `<!-- handoff: epic=<E> after=<story> next=<id|none> written=YYYY-MM-DD -->`.
  It keeps five numbered headings:
  1. Epic state
  2. Last story: what shipped
  3. Plan changes
  4. Next story brief
  5. Gotchas

`epic_close_check` runs `check` (with the Status block rendered in memory)
plus three close rules: the story row is `implemented`, the last ledger
entry is this story, and the handoff `after=` is this story. It writes
nothing.

When problems remain:

```
Fix these, then call epic_close_check again. The ledger entry has five bullets: Branch / PR, Shipped, Decisions, Deviations, Effects on later stories. HANDOFF.md is rewritten whole with headings 1 to 5.
```

When it is ready:

```
The package is ready to close. Call epic_close now.
```

`epic_close` must run on the story branch. It renders the Status block,
checks again, and refuses when there are uncommitted changes outside the
epic folder. It commits the epic folder, pushes, and opens the story PR into
the epic branch, with the ledger entry as the PR body. When no open rows
remain, it also opens a draft epic PR into the base branch.

After `epic_close`, the waiting text:

```
PR #<n> opened: <url>. Tell the user to merge it, then reply `next`. Stay in this session. Do not build the next story here.
```

Without `gh`, the PR is not opened:

```
The PR was not opened. Run these commands, or ask the user to run them:
  <command>
Then tell the user to merge the PR, then reply `next`. Stay in this session. Do not build the next story here.
```

## next

You merge the story PR on GitHub. Then you reply `next` to the closing
agent, or press **Start next story** in the panel, or run `/epic next`, or
pick **Epic: start next story** in the Command Center.

`next` fetches `origin` and reads the package on `origin/<epic branch>`. The
story counts as merged when it is the last ledger entry on that tip. It
refuses when the story is not merged yet, when a later story already
closed, or when the package on the tip fails `check`. With `gh`, it finds
the merged story PR and reads its conversation comments.

When the agent calls `epic_next` and a next story exists, the answer ends:

```
<next story> <title> is next. The plugin is starting the successor now; wait for its name, then this session is finished.
Spawn pending for <next story>: the plugin starts the successor now.
```

When the turn ends, the plugin spawns the successor and sends the closing
agent:

```
Started agent "<next story> <title>" in worktree <branch>. It will read the handoff and stop for plan approval. This session is finished.
```

If a Paseo workspace already has the next story's branch checked out, the
plugin starts no new agent. The message says where that workspace is and
tells you to start an agent there with `/epic start <next story>` if none
is running.

If the spawn fails, the closing agent gets:

```
Spawn failed: <error>. Start the next story by hand with /epic start <next story>.
```

When the last story closed:

```
<epic> is closed: <story> was the last story. What remains is the draft epic PR from <epic branch> into the base branch; review and merge it. This session is finished.
```

Without `gh`, these texts also carry this sentence:

```
The PR and its comments were not read because `gh` was not available; check the PR by hand for answers to open questions.
```

The successor's first prompt:

```
/epic start <next story>

Answers from PR #<n> (conversation comments, oldest first):
- <author>, <YYYY-MM-DD>: <body>

<hooks.nextPrompt>
```

The last block appears only when `.epic.yml` sets `hooks.nextPrompt`. With
no comments, the list is the word `none`. Without `gh`, the second
line is ``Answers from the story PR: not read, because `gh` was not available.``
Only conversation comments go forward. Review comments on code lines
belonged to the merged story.

## check

`/epic check [id]`, the panel's **Check** button, or the `epic_check` tool.
Without an id it checks every package. The rules:

- The H1 id matches the folder.
- The Status block keys are present and equal to what the story table
  implies.
- Row statuses are valid: `planned`, `in_progress`, `implemented`,
  `dropped`.
- Implemented rows have Done and a ledger entry.
- Ledger entries map to implemented rows and have valid dates.
- The handoff header has `epic=`, `after=` equal to the last ledger entry,
  `next=` equal to the first open row, and `written=` as a date.
- The five handoff headings are present.

After `epic_check`: `ok` when clean, else:

```
Fix the listed problems, then call epic_check again.
```

## status

`/epic status [id]` opens the panel. The `epic_status` tool returns the
same record, then one of:

```
The package has problems. Fix the listed problems, then call epic_check.
```

```
<epic> has no open story.
```

```
The next open story is <story>. To begin it, call epic_start with <story>.
```
