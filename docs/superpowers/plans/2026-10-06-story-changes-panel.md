# Story Changes in the Epic Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From any workspace of the repo, the Epic panel's story rows expand to show the story's Paseo workspace and agent (with jump buttons), its PR, and the files the story created or changed, committed or not.

**Architecture:** One new core function computes a story worktree's changes against the epic branch with git. One new RPC resolves the story's workspace, agent and PR through the daemon SDK and returns the changes. The panel's story table becomes expandable rows that call that RPC on expand.

**Tech Stack:** TypeScript, `@getpaseo/plugin` 0.10.2 (host-supplied; never import `@getpaseo/client` or `@getpaseo/protocol`, see `server/sdk-types.ts`), zod 4, React Native primitives, vitest 4, git and `gh` as child processes.

**Spec:** `docs/superpowers/specs/2026-10-06-story-changes-panel-design.md`

**Branch:** `feat/story-changes-panel` in `/Volumes/ExDrive/_sources/paseo-epic` (spec already committed there).

## Global Constraints

- Server code imports no React; client code imports no `node:` modules and nothing from `server/`; `shared/` imports only `@getpaseo/plugin` and `zod`. Types from Paseo come from `server/sdk-types.ts` on the server and `@getpaseo/plugin/client` on the client. `test/install-boundary.test.ts` enforces the import rule.
- Git and `gh` run through `run`/`runRaw` in `server/core/git.ts` (execFile, no shell).
- Every refusal is one sentence that says what to do next, thrown as `EpicError`. Missing workspace, agent or PR are `null` fields with a `note`, never errors.
- Committed changes: `git diff --name-status origin/<epic>...HEAD` (three dots). Uncommitted: `git status --porcelain --untracked-files=all`. No fetch.
- Client UI uses `View`, `Text`, `Pressable`, `ScrollView` only; colors from `theme.colors`; padding from `layout.compact`; no HTML, `className`, `onClick`, `window`, `document`. Audit: `rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/ index.client.tsx` prints nothing.
- No timers or polling in the panel. The RPC runs on expand and on Refresh.
- No change to `.epic.yml`, the MCP tools, the spawn, or the bundle (`npm run build:mcp` must leave `mcp/epic-mcp.mjs` unchanged; the MCP server does not import the new code).
- Commits end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; use `git -c commit.gpgsign=false commit`.

## Review Focus

1. A story branch just cut, with no commits and a clean tree, must report `files: []` and `ahead: 0`, not an error. Test in Task 1.
2. A merge of `main` into the epic branch after the story branched must not show main's files in the story's list (three-dot diff). Test in Task 1.
3. Paths with spaces and renames (`R100\told\tnew` in porcelain) must parse to one entry with the new path. Test in Task 1.
4. Two workspaces on the same story branch (a stale duplicate worktree) must not break resolution: the first match wins and `note` says a duplicate exists. Test in Task 2.
5. Expanding row B while row A's RPC is still running must not place A's result under B: per-row state keyed by story id. Pinned by the component structure in Task 3 (state is a `Map<storyId, RowState>`); no automated test for RN.

---

## File Structure

```
server/core/changes.ts          storyChanges(dir, epicBranch), parsePorcelain, parseNameStatus
server/rpc/story-changes.ts     resolveStoryChanges(deps, input) pure over injected deps
server/rpc/handlers.ts          registers epic.story-changes (modify)
shared/contracts.ts             storyChangesRpc + schemas (modify)
client/StoryRow.tsx             one row: header Pressable + expanded area
client/FileList.tsx             the file lines
client/EpicPanel.tsx            composes StoryRow, holds expand state (modify, shrinks)
client/strings.ts               new labels (modify)
test/changes.test.ts            core on the bare remote
test/handlers.test.ts           resolveStoryChanges with a fake PaseoApi
docs/README.md, README.md, docs/VERIFICATION.md (modify)
```

---

### Task 1: Core `storyChanges`

**Files:**
- Create: `server/core/changes.ts`, `test/changes.test.ts`

**Interfaces:**
- Consumes: `run`, `runRaw`, `remoteBranchExists`, `currentBranch` from `server/core/git.ts`; `EpicError` from `server/core/types.ts`; `RemoteFixture`, `git` from `test/fixtures.ts`; `cmdStart` from `server/core/commands.ts`; `loadConfig`.
- Produces:
  - `type ChangeStatus = "A" | "M" | "D" | "R"`
  - `interface ChangedFile { path: string; status: ChangeStatus; committed: boolean }`
  - `interface StoryChanges { base: string; head: string; ahead: number; files: ChangedFile[] }`
  - `storyChanges(dir: string, epicBranch: string): Promise<StoryChanges>` — refuses with `` origin/<epicBranch> does not exist; push the epic branch first `` when `remoteBranchExists(dir, epicBranch)` is false; `base` is `origin/<epicBranch>`, `head` is `currentBranch(dir)`, `ahead` is `git rev-list --count origin/<epicBranch>..HEAD`.
  - `parseNameStatus(out: string): ChangedFile[]` (committed: true; `R<n>\told\tnew` → `{ path: new, status: "R" }`; `C<n>` treated as `A` with the new path; `T` treated as `M`).
  - `parsePorcelain(out: string): ChangedFile[]` (committed: false; `??` → `A`; `D ` or ` D` → `D`; `R  old -> new` → `R` with new path; anything else → `M`; strip surrounding quotes git adds for special characters).
  - Merge rule in `storyChanges`: start from committed entries keyed by path, then for each uncommitted entry set or replace that path's entry with `committed: false` and the uncommitted status, except keep `A` when the committed status was `A` and the uncommitted is `M` (a new file edited again is still new). Sort by path.

- [ ] **Step 1: Write the failing tests**

`test/changes.test.ts`, using `RemoteFixture`: `setup`, `planAndPush`, then `cmdStart(root, cfg, "TH-901", { noGh: true })` so the worktree is on `feat/TH-901-first-thing`.

```ts
test("a just-cut story has no changes", async () => {
  // after cmdStart only
  const out = await storyChanges(fx.root, "epic/E99-test-epic");
  expect(out).toEqual({ base: "origin/epic/E99-test-epic", head: "feat/TH-901-first-thing", ahead: 0, files: [] });
});

test("committed, uncommitted, untracked, deleted and renamed files", async () => {
  // commit 1: add src/one.ts, modify docs/templates/epic.md, delete docs/templates/handoff.md
  // commit 2: git mv src/one.ts src/uno.ts
  // then: edit src/uno.ts (uncommitted), create "notes/with space.md" (untracked)
  const out = await storyChanges(fx.root, "epic/E99-test-epic");
  expect(out.ahead).toBe(2);
  expect(out.files).toEqual([
    { path: "docs/templates/epic.md", status: "M", committed: true },
    { path: "docs/templates/handoff.md", status: "D", committed: true },
    { path: "notes/with space.md", status: "A", committed: false },
    { path: "src/uno.ts", status: "R", committed: false },
  ]);
});

test("a merge of main into the epic does not pollute the story's list", async () => {
  // clone the bare remote a second time into fx.tmp/other; commit main-only.txt on main; push
  // in fx.root: git fetch; checkout epic/E99-test-epic; merge --no-edit origin/main; push; checkout feat/TH-901-first-thing
  // the story branch (unchanged) must still show files: [] and ahead: 0
});

test("refuses when the epic branch is not on the remote", async () => {
  await expect(storyChanges(fx.root, "epic/E1-missing")).rejects.toThrow(
    "origin/epic/E1-missing does not exist; push the epic branch first",
  );
});

test("parsePorcelain and parseNameStatus handle renames and quoted paths", () => {
  expect(parseNameStatus("M\ta.ts\nR100\told.ts\tnew.ts\nA\tb.ts\n")).toEqual([
    { path: "a.ts", status: "M", committed: true },
    { path: "new.ts", status: "R", committed: true },
    { path: "b.ts", status: "A", committed: true },
  ]);
  expect(parsePorcelain('?? "with space.md"\n D gone.ts\nR  old.ts -> new.ts\n M edit.ts\n')).toEqual([
    { path: "with space.md", status: "A", committed: false },
    { path: "gone.ts", status: "D", committed: false },
    { path: "new.ts", status: "R", committed: false },
    { path: "edit.ts", status: "M", committed: false },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/changes.test.ts`
Expected: FAIL, `server/core/changes.ts` not found.

- [ ] **Step 3: Implement `server/core/changes.ts`**

Use `run(["git", "diff", "--name-status", `origin/${epicBranch}...HEAD`], dir)` and `run(["git", "status", "--porcelain", "--untracked-files=all"], dir)`. The parsers are pure functions over the output strings.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/changes.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add server/core/changes.ts test/changes.test.ts
git commit -m "feat(core): storyChanges lists a story's committed and uncommitted files"
```

---

### Task 2: The `epic.story-changes` RPC

**Files:**
- Create: `server/rpc/story-changes.ts`, `test/handlers.test.ts`
- Modify: `shared/contracts.ts`, `server/rpc/handlers.ts`

**Interfaces:**
- Consumes: `storyChanges`, `StoryChanges` (Task 1); `findEpicDir`, `loadLocal` from `server/core/locate.ts`; `rowOf`, `epicBranch` from `server/core/check.ts`; `ghAvailable`, `ghOpenPrs`, `ghMergedPrs` from `server/core/git.ts`; `pickMergedPr` from `server/core/commands.ts`; `loadConfig`; `PaseoApi` from `server/sdk-types.ts`; the paging pattern of `findWorkspaceByBranch` in `server/rpc/handlers.ts`.
- Produces:
  - In `shared/contracts.ts`: `storyChangesRpc = defineRpc({ name: "epic.story-changes", input: z.object({ workspaceDir, story: z.string() }), output: storyChangesResultSchema })` where the result schema is exactly spec section 4's object: `story`, `title`, `status`, `done`, `workspace: { id, directory, name } | null`, `agent: { id, title, status } | null`, `pr: { number, url, state: z.enum(["open","merged"]) } | null`, `changes: { base, head, ahead, files: [{ path, status: z.enum(["A","M","D","R"]), committed }] } | null`, `note: z.string().nullable()`.
  - In `server/rpc/story-changes.ts`:
    - `interface StoryChangesDeps { listWorkspaces: () => Promise<Array<{ id: string; directory: string; name: string; branch: string | null }>>; listAgents: () => Promise<Array<{ id: string; title: string | null; status: string; cwd: string; labels: Record<string, string>; createdAt: string }>>; changes: typeof storyChanges; gh: { available: () => Promise<boolean>; openPrs: typeof ghOpenPrs; mergedPrs: typeof ghMergedPrs } }`
    - `resolveStoryChanges(deps: StoryChangesDeps, input: { root: string; story: string }): Promise<StoryChangesResult>` implementing spec section 4 steps 1 to 5. Unknown story refusal: `` no epic package lists <story>; check the story id `` (wrap `findEpicDir`'s own `EpicError`). The `note` values: `no workspace for <story> on this daemon` when none; `more than one workspace is on <branch>; showing <name>` when several (first match wins); otherwise `null`.
    - `defaultDeps(paseo: PaseoApi): StoryChangesDeps` building the lists from `paseo.workspaces.list` (fields `id`, `workspaceDirectory ?? ""`, `name`, `gitRuntime?.currentBranch ?? null`, paged with `page: { limit: 200 }` like `findWorkspaceByBranch`) and `paseo.agents.list` (entries `.agent`: `id`, `title`, `status`, `cwd`, `labels ?? {}`, `createdAt`), and the real git and gh functions.
  - In `server/rpc/handlers.ts`: `server.handle(storyChangesRpc, ({ workspaceDir, story }, { paseo }) => refusalsAsErrors(() => resolveStoryChanges(defaultDeps(paseo), { root: workspaceDir, story })))`. Leave `findWorkspaceByBranch` as it is.
  - Agent match order: label `epic.story === story` first, then cwd under the workspace directory (equal, or starts with `dir + "/"` or `dir + "\\"`); among matches the newest `createdAt`, status not `closed`.
  - PR: `openPrs(root, epicBranch)` filtered by `headRefName.startsWith(prefix + story + "-")` → `state: "open"`; else when the row status is `implemented`, `pickMergedPr(await mergedPrs(root, epicBranch), story, prefix)` → `state: "merged"`; `gh` unavailable or any `EpicError` from gh → `pr: null`.

- [ ] **Step 1: Write the failing tests**

`test/handlers.test.ts` with a hand-written `StoryChangesDeps` fake (no git: `changes` returns a fixed `StoryChanges` and records its arguments; `gh.available` returns false unless the test sets PRs). The package comes from `makeRoot` + `fill` in `test/fixtures.ts` (E99 with TH-901 implemented, TH-902 and TH-903 planned).

```ts
test("finds the workspace by branch and the agent by label", ...)
// workspaces: [{ id: "ws_1", directory: "/wt/other", name: "Other", branch: "main" }, { id: "ws_2", directory: "/wt/TH-902", name: "TH-902 Second thing", branch: "feat/TH-902-second-thing" }]
// agents: an older one with cwd "/wt/TH-902" and no labels, a newer one with labels { "epic.story": "TH-902" } and cwd "/elsewhere"
// expect workspace ws_2, agent = the labelled one, changes called with ("/wt/TH-902", "epic/E99-test-epic"), note null
test("falls back to the agent whose cwd is under the workspace", ...)
// no labels; agents: closed one under /wt/TH-902 (skipped), idle one at /wt/TH-902/apps (chosen), idle one at /wt/TH-9020 (not under)
test("no workspace gives null fields and the note", ...)
// workspace, agent, changes all null; note "no workspace for TH-902 on this daemon"; changes dep not called
test("a duplicate worktree on the branch picks the first and notes it", ...)
// two entries on feat/TH-902-second-thing; workspace = first; note "more than one workspace is on feat/TH-902-second-thing; showing <first name>"
test("open PR wins, merged PR only for implemented rows, none without gh", ...)
// gh available: openPrs returns one PR with headRefName feat/TH-902-second-thing → state open
// TH-901 (implemented), no open PR, mergedPrs has headRefName feat/TH-901-first-thing → state merged
// TH-902 planned, no open PR → pr null even with merged list; gh unavailable → pr null
test("unknown story refuses with the next step", async () => {
  await expect(resolveStoryChanges(deps, { root, story: "TH-999" })).rejects.toThrow(
    "no epic package lists TH-999; check the story id",
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/handlers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the contract, `story-changes.ts`, and the handler registration**

- [ ] **Step 4: Run tests, typecheck, and the install-boundary test**

Run: `npx vitest run test/handlers.test.ts test/install-boundary.test.ts && npm run typecheck`
Expected: all passed; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add shared/contracts.ts server/rpc/story-changes.ts server/rpc/handlers.ts test/handlers.test.ts
git commit -m "feat(rpc): epic.story-changes resolves a story's workspace, agent, PR and files"
```

---

### Task 3: Expandable story rows in the panel

**Files:**
- Create: `client/StoryRow.tsx`, `client/FileList.tsx`
- Modify: `client/EpicPanel.tsx`, `client/strings.ts`, `test/strings.test.ts`

**Interfaces:**
- Consumes: `storyChangesRpc` (Task 2) through `useRpc`; `Status["rows"]` from `client/results.ts`; `PluginWorkspacePanelProps["navigation"]`, `theme`, `layout`; the existing `useStyles`, `ActionButton`, `labels`.
- Produces:
  - `client/strings.ts` adds to `labels`: `refresh: "Refresh"`, `openWorkspace: "Open workspace"`, `openAgent: "Open agent"`, `workspace: "workspace"`, `agent: "agent"`, `pr: "PR"`, `noPr: "none yet"`, `uncommitted: "uncommitted"`, `noChanges: "No changes yet."`, `loadingRow: "Reading the story…"`; and a function `changesVs(base: string, files: number, uncommitted: number): string` returning `changes vs <base>: <files> files, <uncommitted> uncommitted`.
  - `client/FileList.tsx`: `FileList({ files, compact, styles })` renders one line per file: status letter (fixed width), the path, and the `uncommitted` tag in `foregroundMuted`. In compact layout the visible label is the last two path segments but the `selectable` text content is the full relative path.
  - `client/StoryRow.tsx`: `StoryRow({ row, expanded, state, onToggle, onRefresh, navigation, compact, styles })` where `type RowState = { phase: "idle" | "loading" | "ready" | "error"; data?: StoryChangesResult; error?: string }`. The header is a `Pressable` (`accessibilityRole="button"`, `accessibilityState={{ expanded }}`) with a chevron (`▸` / `▾`), a status dot (`View` 8×8, radius 4; accent for `in_progress`, foreground for `implemented`, foregroundMuted otherwise), then the same cells as today. The expanded area renders spec section 5's lines in order; `Open workspace` and `Open agent` buttons render only when `navigation` is defined and the field is not null; the PR link uses `navigation.openBrowser` when present, else the URL as selectable text; `Refresh` is a `Pressable` text link.
  - `client/EpicPanel.tsx`: replaces `StoryTable` with a list of `StoryRow`s; holds `expanded: Set<string>` and `rowStates: Map<string, RowState>` in state; after status loads the first time, expands the `in_progress` row, else the `status.next` row; `toggle(story)` expands or collapses and calls `loadRow(story)` when expanding without data; `loadRow` calls `storyChangesRpc({ workspaceDir, story })` with a per-row sequence number so a stale response is dropped; a status reload keeps `expanded` and `rowStates`. Target: the file stays under 220 lines once the table code moves out; if it does not, move the header block into `client/PanelHeader.tsx` and say so in the report.
  - Compact layout: the header is two stacked lines as today, plus the dot and chevron on the first line.

- [ ] **Step 1: Write the strings test, then the files**

Add to `test/strings.test.ts`: `expect(changesVs("origin/epic/E1-x", 12, 3)).toBe("changes vs origin/epic/E1-x: 12 files, 3 uncommitted")`. No unit tests for the React Native components.

- [ ] **Step 2: Typecheck, the mobile audit, the strings test**

Run: `npm run typecheck && rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/ index.client.tsx; npx vitest run test/strings.test.ts`
Expected: typecheck exits 0; `rg` prints nothing (exit 1); 2 passed.

- [ ] **Step 3: Confirm the bundle is untouched**

Run: `npm run build:mcp && git status --short mcp/ server/mcp/`
Expected: `git status` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add client/ test/strings.test.ts
git commit -m "feat(panel): story rows expand to the story's workspace, agent, PR and changed files"
```

---

### Task 4: Docs and verification rows

**Files:**
- Modify: `README.md`, `docs/README.md`, `docs/VERIFICATION.md`

**Interfaces:**
- Consumes: the behavior shipped in Tasks 1 to 3; the spec's section 5 review flow sentence.

- [ ] **Step 1: Update the docs**

- `README.md` "The Epic panel": describe the expandable rows (workspace and agent with Open buttons, PR link, `changes vs <base>` list with the `uncommitted` tag), the default-expanded in-progress row, Refresh, and the review flow: open the panel in any workspace of the repo, expand the story, press **Open workspace**, review in Paseo's Diff tab. The three-callers table row for the human adds "opens the story's workspace and agent from the panel".
- `docs/README.md`: the same in the panel bullet, and one sentence that the panel reads `epic.story-changes` for an expanded row.
- `docs/VERIFICATION.md`: new pending rows: 21 expand the in-progress row in the main checkout and see the worktree's files; 22 **Open workspace** lands in the worktree (record what `openWorkspace` does); 23 the list matches `git status --porcelain` and `git diff --name-status origin/<epic>...HEAD` in the worktree; 24 **Open agent** opens the story agent; 25 compact layout and a second theme for the expanded row.

- [ ] **Step 2: Check the claims against the code**

Every label and button name in the docs exists in `client/strings.ts`; the RPC name matches `shared/contracts.ts`.

- [ ] **Step 3: Run the whole suite once**

Run: `npm test && npm run typecheck`
Expected: all test files pass; typecheck exits 0.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/README.md docs/VERIFICATION.md
git commit -m "docs: the Epic panel's story rows and the review flow"
```

---

## Self-review notes

- Spec coverage: section 3 → Task 1; section 4 → Task 2; section 5 → Task 3; sections 6 to 8 → Tasks 1 to 4 (errors in 1 and 2, tests in 1 to 3, docs in 4); section 9's facts are pinned above (workspace entry `id`, `name`, `workspaceDirectory`, `gitRuntime.currentBranch`; agent entry `.agent` with `id`, `title`, `status`, `cwd`, `labels`, `createdAt`; `openWorkspace` behavior recorded by verification row 22).
- Names used across tasks: `StoryChanges`, `ChangedFile`, `ChangeStatus`, `storyChanges`, `parseNameStatus`, `parsePorcelain` (Task 1); `storyChangesRpc`, `StoryChangesResult`, `StoryChangesDeps`, `resolveStoryChanges`, `defaultDeps` (Task 2); `StoryRow`, `FileList`, `RowState`, `labels.*`, `changesVs` (Task 3). Each is defined in the task that first produces it.
- Review Focus 1 to 4 have tests in Tasks 1 and 2; item 5 is structural (per-row state map with sequence numbers) in Task 3.
