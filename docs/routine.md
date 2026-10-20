# The routine

This page is the routine in prose. Where a tool gives the agent text, this
page quotes that text exactly, as it is written in `server/core/text.ts`,
`client/strings.ts` and `server/mcp/main.ts`. Words in angle brackets
(`<story>`) are filled in at run time.

Every tool answer is the result as JSON, a blank line, then the "what to do
now" text below. A refusal is an error result with one sentence that says
what to do next.

```
  init --> start --> build --> close --> (you merge) --> next
             ^                                            |
             +------------- fresh agent, next story ------+
```

The plugin runs this flow and nothing else. It checks no story ids and no
file content. It reads a few parts of the package (see
[What the plugin reads](#what-the-plugin-reads)) and refuses only when the
flow cannot go on. Your repo owns its own rules and names them in the
`.epic.yml` hooks ([epic-yml.md](epic-yml.md)).

## What the plugin reads

| Read | From | Used for |
| --- | --- | --- |
| Epic id | the package folder name before the first `-` | finding the package, the epic branch |
| Title | the `EPIC.md` H1, after the id and a dash when they are there | display, PR titles |
| Story rows | the `## Story list` table; the id is the first word of the first cell | title, lane and status for display; the slug of the story branch |
| Handoff header | `<!-- handoff: epic=… after=… next=… written=… -->` in `HANDOFF.md` | the next story (`next=`) and the last closed story (`after=`) |
| Status block | the lines between `<!-- epic-status:begin -->` and `<!-- epic-status:end -->` | display only |
| Ledger entry | `### <story> …` under `## Ledger` | the story PR body |

Rows and ledger entries inside `<!-- -->` comment blocks are skipped. Any id
shape works: `TH-1`, `TH-E10-1`, `story-7`, `ABC`. The epic id itself cannot
hold a `-`, because the id is the folder name before the first `-`.

## init

An agent calls `epic_init` (inputs `epic` and `title`).

- The epic id must be non-empty, with no `-`, `/`, `\` or spaces. Any other
  shape is fine; the repo decides how it mints ids.
- The working tree must be clean.
- The plugin fetches `origin` and checks out the epic branch
  `<epicBranchPrefix><epic>-<slug>` (default prefix `epic/`). It reuses the
  branch when it exists locally or on `origin`. Otherwise it creates the
  branch from `origin/<baseBranch>`.
- It writes `EPIC.md` and `HANDOFF.md` into `<epicsDir>/<epic>-<slug>/`, from
  the templates (yours from `.epic.yml` `templates`, else the shipped ones).
- It refuses when `EPIC.md` already exists.
- It does not commit or push.

After `epic_init`, the agent reads:

```
Created the epic package on branch <branch>. Fill EPIC.md and HANDOFF.md for the first story.
<hooks.init lines, one per line>
Then commit and push the epic branch. The first story starts in a fresh agent with epic_start; do not build it in this session.
```

`start` and `next` read the package from `origin/<epic branch>`, so the plan
must be pushed before the first story starts.

## start

An agent calls `epic_start` with a story id or the epic id. In Paseo you can
also send the newest open agent in the workspace this prompt:

```
Start story <story>: call the epic_start tool with <story>. It cuts the story branch from the epic tip and returns the handoff. Read the handoff and the files it lists, then build the story as an ordinary task.
```

`epic_start` fetches `origin` and reads `HANDOFF.md` from
`origin/<epic branch>` (never from the working copy). The story is the
header's `next=`. It cuts `<branchPrefix><story>-<slug>` from that tip, or
resumes the branch if it exists. The slug is the story's packet folder
(`<story>-<slug>`) on the tip when there is one, else the row title, else
the story id. It refuses when:

- the working tree is dirty;
- `origin/<epic branch>` does not exist;
- `HANDOFF.md` on the tip is missing or has no handoff header;
- the header says `next=none` (no open story);
- the story asked for is not the header's `next=`;
- with `gh`: an open PR still targets the epic branch (one story in
  flight). Without `gh`, this is not checked, and the result carries a
  warning that says so.

After `epic_start`, the agent reads:

```
This handoff is your context. Read the files it lists. Do not re-read the whole EPIC.md unless the handoff sends you there. <hooks.start lines>
When the story is done:
<hooks.close lines, one per line>
Call epic_close with <story>.
```

Between `start` and `close` the agent builds the story however you like.
The plugin adds no method.

## close

The close steps are your repo's: the `hooks.close` lines that `epic_start`
quoted. Typically the agent updates the story row and the ledger entry in
`EPIC.md`, rewrites `HANDOFF.md` with `after=<story>` and the `next=` story,
and runs the repo's own check. The plugin checks none of this.

In Paseo you can also send the agent the close prompt. It is the close lines,
then the call; the client cannot read `.epic.yml`, so from the client it is
only the last line:

```
<hooks.close lines, one per line>
Call epic_close with <story>.
```

`epic_close` must run on the story branch. It refuses when:

- the current branch is not `<branchPrefix><story>-…`;
- the local `HANDOFF.md` is missing or has no handoff header;
- there are uncommitted changes outside the epic folder.

Then it commits the epic folder, pushes, and opens the story PR into the
epic branch, with the story's ledger entry as the PR body. When the local
handoff says `next=none`, it also opens a draft epic PR into the base branch.

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
agent, or press **Start next story** in the panel, or pick **Epic: start
next story** in the Command Center.

`next` fetches `origin` and reads `HANDOFF.md` on `origin/<epic branch>`.
The story counts as merged when that header says `after=<story>`. It
refuses when the header is missing, or when it names another story:

```
<story> is not merged into origin/<epic branch> yet (the handoff there says after=<id>); merge the story PR first, then run next again
```

With `gh`, it also finds the merged story PR and reads its conversation
comments. The next story is the header's `next=`.

When the panel or the Command Center runs `next` without a story, the story
is the local handoff's `after=`.

When the agent calls `epic_next` and a next story exists, the answer starts
with the pending line, then the JSON, a blank line, and the "what to do
now" text:

```
Spawn pending for <next story> after <closed story>: the plugin starts the successor now.
<JSON>

<next story> <title> is next. The plugin is starting the successor now; wait for its name, then this session is finished.
```

When the turn ends, the plugin spawns the successor and sends the closing
agent:

```
Started agent "<next story> <title>" in worktree <branch>. It will read the handoff and stop for plan approval. This session is finished.
```

If a Paseo workspace already has the next story's branch checked out, the
plugin starts no new agent. The message tells the closing agent not to
start one itself, and to tell you where that workspace is and that you can
start an agent there that calls `epic_start` with the next story if none is
running. If the branch exists locally with no workspace on it, the new
worktree checks it out.

If the plugin finds a different next story than the pending line names:

```
Spawn mismatch: the plugin found <found> as the next story but the agent announced <next story>; start the next story by hand: tell a fresh agent in its worktree to call epic_start with <next story>.
```

If the spawn fails, the closing agent gets:

```
Spawn failed: <error>. Start the next story by hand: tell a fresh agent in its worktree to call epic_start with <next story>.
```

When the last story closed (`next=none`):

```
<epic> is closed: <story> was the last story. What remains is the draft epic PR from <epic branch> into the base branch; review and merge it. This session is finished.
```

Without `gh`, these texts also carry this sentence:

```
The PR and its comments were not read because `gh` was not available; check the PR by hand for answers to open questions.
```

The successor's first prompt:

```
Start story <next story>: call the epic_start tool with <next story>. It cuts the story branch from the epic tip and returns the handoff. Read the handoff and the files it lists, then build the story as an ordinary task.

Answers from PR #<n> (conversation comments, oldest first):
- <author>, <YYYY-MM-DD>: <body>
- <author>, <YYYY-MM-DD> (untrusted, not a repo member): <body>

<hooks.nextPrompt>
```

The last block appears only when `.epic.yml` sets `hooks.nextPrompt`. With
no comments, the list is the word `none`. Without `gh`, the second
line is ``Answers from the story PR: not read, because `gh` was not available.``
Only conversation comments go forward. Review comments on code lines
belonged to the merged story. A comment by an `OWNER`, `MEMBER` or
`COLLABORATOR` of the repo is listed plainly; any other comment carries
`(untrusted, not a repo member)`.

## status

The `epic_status` tool returns the rows, the Status block values as written
(`state`, `stories`), `next` from the local handoff header, how far the epic
branch is behind the base branch, and the open story PR. Then one of:

```
<epic> has no open story.
```

```
The next open story is <story>. To begin it, call epic_start with <story>.
```

```
<epic> has no HANDOFF.md handoff header, so it names no next story.
```

In a repo with `.epic.yml` and no epic yet:

```
This repo has no epic yet: no EPIC.md under <epicsDir>. Call epic_init with an epic id and a title to create one.
```
