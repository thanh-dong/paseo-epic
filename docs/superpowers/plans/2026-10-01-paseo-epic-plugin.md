# paseo-epic Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Paseo plugin that runs an epic story by story: a tested TypeScript core ported from inflow's `epic.py`, an injected `epic` MCP server for agents, an Epic panel plus `/epic` slash command for the human, and a `next` step that spawns the successor agent after the PR merges.

**Architecture:** One core (`server/core/`) does the parsing, lint, git and `gh` work. Three callers share it: RPC handlers behind the panel and slash command, a stdio MCP server bundled with esbuild for agents, and a `before agent.create` hook that injects that server. The `next` spawn calls the daemon SDK through an injected `PaseoApi`, so tests use a fake.

**Tech Stack:** TypeScript 5.9, `@getpaseo/plugin` 0.10.2 (dev dep; host supplies runtime), zod 4, React Native primitives for the panel, `@modelcontextprotocol/sdk` 1.31 bundled by esbuild into one file, `yaml` 2.9 for `.epic.yml`, vitest 5 for tests, git and `gh` as child processes.

**Spec:** `docs/superpowers/specs/2026-10-01-paseo-epic-plugin-design.md`

**Port source (read-only reference, in the inflow repo):** `/Volumes/ExDrive/_sources/_inflow/inflow/scripts/epic.py`, `/Volumes/ExDrive/_sources/_inflow/inflow/scripts/tests/test_epic.py`, `/Volumes/ExDrive/_sources/_inflow/inflow/docs/templates/epic.md`, `/Volumes/ExDrive/_sources/_inflow/inflow/docs/templates/handoff.md`.

## Global Constraints

- Plugin manifest `paseo-plugin.json`: `{ "id": "epic", "requirements": { "paseo": ">=0.10.2" } }`.
- Entry files only `index.client.tsx` and `index.server.ts` in the root; code lives in `client/`, `server/`, `shared/`. `shared/` imports only `@getpaseo/plugin` root and `zod`. Client code imports no `node:` modules. Server code imports no React.
- Client UI uses `View`, `Text`, `Pressable`, `ScrollView` from `react-native` only; colors from `theme.colors`; padding from `layout.compact`. No HTML, `className`, `onClick`, `window`, `document`.
- Story ids match `^[A-Z]{2,}-\d+$`; epic ids `^E\d+$`; epic branch `epic/<Eid>-<slug>`; story branch `<branchPrefix><id>-<slug>`; slug is lowercase, `[^a-z0-9]+` to `-`, trimmed, max 48 chars, `story` when empty.
- `.epic.yml` defaults: `epicsDir: docs/stories/epics`, `branchPrefix: feat/`, `baseBranch: main`, `hooks.start: []`, `hooks.close: []`. The plugin never executes anything from this file.
- Single user, single epic, one story in flight. No polling, no timers, no watchers.
- Every refusal is one sentence that says what to do next, thrown as `EpicError`.
- Dates in files are `YYYY-MM-DD`. Commit message at close: `docs(<Eid>): close <story>; handoff for <next|none>`.
- Git and `gh` run through `execFile` (no shell). Without `gh`, PR steps return manual instructions, never silently skip.
- Tests: `npm test` runs vitest; git flow tests use a temporary bare remote under `os.tmpdir()`; set `GIT_CONFIG_NOSYSTEM=1`, `user.name`, `user.email` in the fixture.
- Commit after every task with a conventional message.

## Review Focus

1. A malformed or unknown-key `.epic.yml` must produce one clear `EpicError`, not a crash or silent defaults. Test in Task 3.
2. A story title with unicode, punctuation, or more than 48 significant characters must slug to a valid branch name. Test in Task 2.
3. `next` must find the merged PR when other merged PRs into the epic branch exist and the story branch was deleted on GitHub after the merge; match on `headRefName` prefix only. Test in Task 5.
4. Pressing "Start next story" twice, or calling `epic_next` after the button, must not create a second workspace or agent. Test in Task 8.
5. The create hook must inject the MCP server for an agent whose `cwd` is a worktree of an epic repo, and must not inject for a repo without the epic folder or without status markers. Test in Task 6.

---

## File Structure

```
paseo-epic/
  paseo-plugin.json
  package.json                      scripts: typecheck, test, build:mcp
  tsconfig.json                     from the scaffold, plus node types
  vitest.config.ts
  index.client.tsx                  registers panel, slash command, command center item
  index.server.ts                   registers RPC handlers and the hooks
  shared/contracts.ts               zod RPC contracts + result schemas
  server/core/types.ts              Row, EpicPackage, Handoff, EpicError, result types
  server/core/parse.ts              parseEpic, parseHandoff, section helpers
  server/core/check.ts              checkPackage, renderStatus, expectedNext, counts, expectedState
  server/core/slug.ts               slugify, today
  server/core/config.ts             loadConfig (.epic.yml), EpicConfig, defaults
  server/core/templates.ts          default template text + override lookup
  server/core/git.ts                run, gitDirty, currentBranch, branch exists, gh helpers
  server/core/locate.ts             epicsDir, findEpicDir, loadLocal, loadFromRef, isEpicRepo
  server/core/commands.ts           cmdInit, cmdStart, cmdClose, cmdNext, cmdCheck, cmdRender, cmdStatus
  server/core/text.ts               the "what to do now" paragraphs quoted by tools and prompts
  server/rpc/handlers.ts            RPC handlers over core
  server/rpc/next.ts                spawnNext(deps) with injected PaseoApi
  server/hooks/inject-mcp.ts        before agent.create hook
  server/hooks/spawn-on-next.ts     agent.turn_ended hook that performs the spawn
  server/mcp/main.ts                stdio MCP server entry (bundled)
  mcp/epic-mcp.mjs                  esbuild output, committed, listed in files
  templates/epic.md, templates/handoff.md
  client/EpicPanel.tsx
  client/strings.ts                 panel copy and the two instruction texts
  test/fixtures.ts                  makeRoot, fill, RemoteFixture, ROWS, LEDGER_901
  test/parse-check.test.ts
  test/config.test.ts
  test/git-flow.test.ts
  test/hook.test.ts
  test/mcp.test.ts
  test/next.test.ts
  test/strings.test.ts
  docs/README.md, docs/routine.md, docs/epic-yml.md, docs/VERIFICATION.md
```

---

### Task 1: Scaffold the plugin repo

**Files:**
- Create: `paseo-plugin.json`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `index.client.tsx`, `index.server.ts`, `.gitignore`, `test/smoke.test.ts`

**Interfaces:**
- Produces: a repo where `npm run typecheck` and `npm test` pass with empty entries.

- [ ] **Step 1: Generate the scaffold into the repo**

Run from `/Volumes/ExDrive/_sources/paseo-epic`:
```bash
npx -y @getpaseo/cli@0.10.2 plugin init /tmp/paseo-epic-scaffold
cp /tmp/paseo-epic-scaffold/{paseo-plugin.json,package.json,tsconfig.json,index.client.tsx,index.server.ts} .
rm -rf /tmp/paseo-epic-scaffold
```
Do not copy `client/greeting.tsx`, `client/web.ts`, `server/greeting.ts`, `shared/greeting.ts`.

- [ ] **Step 2: Edit the manifest and package**

`paseo-plugin.json`:
```json
{ "id": "epic", "requirements": { "paseo": ">=0.10.2" }, "build": [["npm", "ci"], ["npm", "run", "build:mcp"]] }
```
`package.json`: `name` `paseo-epic`, `version` `0.1.0`, `license` `MIT`, keep `private: true` until publish; `files` adds `"mcp/"` and `"templates/"`; scripts: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"build:mcp": "esbuild server/mcp/main.ts --bundle --platform=node --format=esm --target=node20 --outfile=mcp/epic-mcp.mjs"`. Dev deps: the scaffold's plus `vitest@^5`, `esbuild@^0.25`, `@types/node@^20`. Runtime deps: `yaml@^2.9`, `@modelcontextprotocol/sdk@^1.31`.

`tsconfig.json`: set `"types": ["react", "node"]`, keep no DOM lib, add `"exclude": ["mcp", "node_modules"]`.

`vitest.config.ts`: `test: { include: ["test/**/*.test.ts"], testTimeout: 30000 }`.

`.gitignore`: `node_modules/`.

- [ ] **Step 3: Replace the entry bodies**

`index.server.ts`:
```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
export default function contribute(_server: PluginServerContext) { return () => {}; }
```
`index.client.tsx`:
```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
export default function contribute(_client: PluginClientContext) { return () => {}; }
```

- [ ] **Step 4: Write the smoke test**

`test/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run typecheck && npm test`
Expected: typecheck exits 0; vitest reports 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold the paseo-epic plugin"
```

---

### Task 2: Core types, parsing, check, render, slug

**Files:**
- Create: `server/core/types.ts`, `server/core/parse.ts`, `server/core/check.ts`, `server/core/slug.ts`, `templates/epic.md`, `templates/handoff.md`, `test/fixtures.ts`, `test/parse-check.test.ts`

**Interfaces:**
- Produces:
  - `class EpicError extends Error` (types.ts).
  - `interface Row { id: string; title: string; lane: string; status: string; done: string; lineNo: number }`
  - `interface EpicPackage { path: string; dir: string; text: string; id: string; title: string; status: Record<string, string>; statusSpan: [number, number] | null; rows: Row[]; ledger: Array<{ id: string; date: string }> }`
  - `interface Handoff { text: string; found: boolean; epic: string; after: string; next: string; written: string }`
  - `parseEpic(path: string, text: string): EpicPackage`; `parseHandoff(text: string): Handoff`; `section(lines: string[], heading: string): string[]`; `ledgerEntry(text: string, story: string): string`.
  - `checkPackage(epic: EpicPackage, handoff: Handoff | null): string[]`; `renderStatus(epic: EpicPackage): string`; `expectedNext(epic): string`; `counts(epic): [number, number]`; `expectedState(epic): "planned" | "in_progress" | "closed"`; `epicBranch(epic): string`; `rowOf(epic, id): Row | undefined`.
  - `slugify(text: string): string`; `today(): string`.
  - Constants: `STATUS_BEGIN`, `STATUS_END`, `ROW_STATUSES`, `OPEN_ROW`, `EPIC_ID_RE`, `STORY_ID_RE`, `HANDOFF_HEADINGS`.
  - `test/fixtures.ts`: `ROWS`, `LEDGER_901`, `TODAY`, `makeRoot(tmp: string): string` (copies the two templates into `<tmp>/docs/templates`), `fill(root, opts?: { rows?; ledger?; after?; next? }): string` (writes a filled `E99-test-epic` package, returns its dir).

- [ ] **Step 1: Copy the templates**

Copy the two inflow template files verbatim into `templates/`. They are the defaults the plugin ships.

- [ ] **Step 2: Write the failing tests**

Port `ParseAndCheck` from `test_epic.py` one test per Python test, same assertions:
`templatePackagePassesCheck`, `filledPackagePassesAndRenderIsStable`, `implementedWithoutLedgerFails` (expects a problem containing `` has no `### TH-901 ``), `handTypedStatusDriftIsReported` (expects `` should be `1 of 3 implemented` ``), `handoffHeaderMustMatchLedgerAndNext` (`after=TH-902 but the last ledger entry is TH-901`), `handoffMissingHeadingFails` (`` heading `## 3. …` missing ``), `closedEpicHasNextNone`.

Add for Review Focus 2:
```ts
test("slugify handles unicode, punctuation, and length", () => {
  expect(slugify("Ünïcode & punctuation!!")).toBe("n-code-punctuation");
  expect(slugify("x".repeat(60))).toHaveLength(48);
  expect(slugify("---")).toBe("story");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/parse-check.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement types.ts, slug.ts, parse.ts, check.ts**

Port line for line from `epic.py` sections "parsing" and "check". `parseEpic` takes the text explicitly (no file read) so `loadFromRef` can pass `git show` output. Keep the row parser's comment skipping and the `Story` header skip. `renderStatus` returns the whole new text and preserves a trailing newline.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/parse-check.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add server/core templates test && git commit -m "feat(core): parse, check, render and slug ported from epic.py"
```

---

### Task 3: Config and templates lookup

**Files:**
- Create: `server/core/config.ts`, `server/core/templates.ts`, `test/config.test.ts`

**Interfaces:**
- Produces:
  - `interface EpicConfig { epicsDir: string; templates?: string; branchPrefix: string; baseBranch: string; profile?: string; hooks: { start: string[]; close: string[]; nextPrompt?: string } }`
  - `loadConfig(root: string): EpicConfig` reads `<root>/.epic.yml` if present, validates with a zod schema (`.strict()`), merges defaults; throws `EpicError` naming `.epic.yml` and the zod issue path on any problem.
  - `templateText(root: string, config: EpicConfig, name: "epic.md" | "handoff.md"): string` returns the override from `config.templates` when that file exists, else the plugin default resolved from `new URL("../../templates/", import.meta.url)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("defaults when .epic.yml is absent", () => {
  expect(loadConfig(root)).toEqual({ epicsDir: "docs/stories/epics", branchPrefix: "feat/", baseBranch: "main", hooks: { start: [], close: [] } });
});
test("reads hooks and profile", () => { /* .epic.yml with profile: story, hooks.start: ["Run the gate."], hooks.nextPrompt */ expect(cfg.profile).toBe("story"); expect(cfg.hooks.start).toEqual(["Run the gate."]); });
test("unknown key is one clear error", () => {
  fs.writeFileSync(path.join(root, ".epic.yml"), "epicDir: x\n");
  expect(() => loadConfig(root)).toThrow(/\.epic\.yml.*epicDir/);
});
test("invalid yaml is one clear error", () => { fs.writeFileSync(path.join(root, ".epic.yml"), "hooks: [\n"); expect(() => loadConfig(root)).toThrow(/\.epic\.yml/); });
test("template override wins over the default", () => { /* config.templates dir holds epic.md "# custom\n" */ expect(templateText(root, cfg, "epic.md")).toBe("# custom\n"); });
test("default template is the shipped file", () => { expect(templateText(root, defaults, "handoff.md")).toContain("<!-- handoff: epic=ENN"); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement config.ts and templates.ts**

Use `yaml.parse`; wrap parse errors into `EpicError(".epic.yml: <message>")`. Zod schema with `.strict()`; map the first issue to `EpicError(".epic.yml: <path>: <message>")`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add server/core/config.ts server/core/templates.ts test/config.test.ts && git commit -m "feat(core): .epic.yml config and template lookup"
```

---

### Task 4: Git helpers, locate, init and start

**Files:**
- Create: `server/core/git.ts`, `server/core/locate.ts`, `server/core/commands.ts` (init, start, check, render), `test/git-flow.test.ts`
- Modify: `test/fixtures.ts` (add `RemoteFixture`)

**Interfaces:**
- Produces:
  - git.ts: `run(cmd: string[], cwd: string, check = true): Promise<string>` (execFile; throws `EpicError` with stderr when `check`), `gitDirty(root)`, `currentBranch(root)`, `remoteBranchExists(root, branch)`, `localBranchExists(root, branch)`, `ghAvailable(): Promise<boolean>`, `ghOpenPrs(root, base, head?): Promise<Array<{ number: number; title: string; headRefName: string; url: string }>>`.
  - locate.ts: `epicsDir(root, config)`, `isEpicRepo(root, config): boolean` (true when `epicsDir` has an `EPIC.md` containing `STATUS_BEGIN`), `findEpicDir(root, config, ref)`, `loadLocal(dir): { epic, handoff }`, `loadFromRef(root, dir, ref)`, `packetSlug(root, dir, branch, story): Promise<string | null>`.
  - commands.ts:
    - `cmdInit(root, config, epicId, title, opts: { fromRef?: string; noGit?: boolean }): Promise<{ dir: string; branch: string }>`
    - `cmdStart(root, config, ref, opts: { dryRun?: boolean; noGh?: boolean }): Promise<StartResult>` where `StartResult = { epic: string; epicBranch: string; behind: string; story: string; title: string; lane: string; storyBranch: string; action: "created" | "resumed" | "dry-run"; handoff: string; warnings: string[] }`
    - `cmdCheck(root, config, ref?): Promise<Array<{ dir: string; problems: string[]; summary: string }>>`
    - `cmdRender(root, config, ref): Promise<{ changed: boolean }>`
  - fixtures.ts: `class RemoteFixture { tmp: string; remote: string; root: string; setup(): Promise<void>; teardown(): void; planAndPush(): Promise<string>; close901(dir: string): Promise<void> }` matching `GitFlow.setUp`, `_plan_and_push`, `_close_901` in the Python tests.

- [ ] **Step 1: Write the failing tests**

Port from `GitFlow`: `startReadsHandoffFromRemoteTipAndGuardsStory`, `startRefusesWhenRemotePackageIsBroken`, `startRefusesMissingRemoteBranch`. Same assertions, e.g. `await expect(cmdStart(root, cfg, "TH-902", { dryRun: true, noGh: true })).rejects.toThrow("written for TH-901, not TH-902")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/git-flow.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement git.ts, locate.ts, and the four commands**

Port `cmd_init`, `cmd_start`, `cmd_check`, `cmd_render` from `epic.py`. `cmdStart` returns the handoff text instead of printing. `init` uses `templateText` from Task 3 for both files, with the same replacements as the Python (`ENN-slug`, `# ENN — Epic title`, `ENN`, `written=YYYY-MM-DD`). `cmdInit` cuts from `opts.fromRef ?? "origin/" + config.baseBranch`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/git-flow.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add server/core test && git commit -m "feat(core): git helpers, locate, init and start"
```

---

### Task 5: close, next, status

**Files:**
- Modify: `server/core/commands.ts`, `server/core/git.ts` (add `ghMergedPrs`, `ghPrComments`), `test/git-flow.test.ts`

**Interfaces:**
- Produces:
  - `cmdClose(root, config, story, opts: { noPr?: boolean; noGh?: boolean }): Promise<CloseResult>` where `CloseResult = { committed: boolean; message: string; pushed: boolean; pr: { number: number; url: string } | null; epicPr: { url: string } | null; manual: string[] }` (`manual` holds the commands to run by hand when `gh` is unused).
  - `closeProblems(root, config, story): Promise<string[]>`: render in memory, `checkPackage`, plus the three close rules; no writes.
  - `cmdNext(root, config, story, opts: { noGh?: boolean }): Promise<NextResult>` where
    `NextResult = { epic: string; epicBranch: string; closed: { story: string; pr: { number: number; url: string; headRefName: string; mergedAt: string; title: string } | null; comments: Array<{ author: string; createdAt: string; body: string }> }; next: { story: string; title: string; lane: string; branch: string; baseRef: string } | null }`.
  - `pickMergedPr(prs: Array<{ headRefName: string } & T>, story: string): T | null`.
  - `cmdStatus(root, config, ref?): Promise<StatusResult>` where `StatusResult = { epic: string; title: string; epicBranch: string; state: string; stories: string; next: string; behind: string | null; rows: Row[]; openPr: { number: number; url: string; headRefName: string } | null; problems: string[] }`. Reads the local package; `behind` and `openPr` are null without `gh` or without a remote.
  - git.ts: `ghMergedPrs(root, base): Promise<Array<{ number; url; headRefName; mergedAt; title }>>` (`gh pr list --base <base> --state merged --limit 100 --json number,url,headRefName,mergedAt,title`), `ghPrComments(root, number): Promise<Array<{ author; createdAt; body }>>` (`gh pr view <n> --json comments`).
  - PR body builder `prBody(epic, story, dir, nextStory)` keeps the inflow text; its handoff paragraph reads: ``After this PR merges, reply `next` to the closing agent, or press "Start next story" in the Epic panel.``

- [ ] **Step 1: Write the failing tests**

Port `closeChecksThenCommitsTheEpicFolder`, `closeRefusesUncommittedStoryWork`, `closeRefusesWrongBranch`, `nextRefusesUntilTheCloseIsOnTheEpicTip`, `nextReportsTheNextStoryAfterTheMerge`, `nextReportsAClosedEpic` from the Python file, using `RemoteFixture.close901`. For `next` after the merge the fixture pushes `feat/TH-901-first-thing:epic/E99-test-epic`.

Add for Review Focus 3:
```ts
test("next picks the merged PR by head prefix among others", () => {
  const prs = [{ headRefName: "feat/TH-900-old", number: 1 }, { headRefName: "feat/TH-901-first-thing", number: 7 }];
  expect(pickMergedPr(prs, "TH-901")?.number).toBe(7);
  expect(pickMergedPr(prs, "TH-902")).toBeNull();
});
```

Add `statusReportsRowsAndNext`: after `planAndPush`, `cmdStatus(root, cfg, "E99")` has `next === "TH-901"`, `rows.length === 3`, `problems` empty.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/git-flow.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement close, closeProblems, next, status**

Port `cmd_close` and `cmd_next` from `epic.py` including the "closed earlier" refusal (`<story> closed earlier; the last story closed on origin/<branch> is <last>, so run next <last>`). `cmdStatus` composes `loadLocal`, `checkPackage`, `git rev-list --count origin/<epic>..origin/<base>` and `ghOpenPrs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add server/core test && git commit -m "feat(core): close, next and status"
```

---

### Task 6: Instruction text, RPC contracts, server entry, MCP injection hook

**Files:**
- Create: `server/core/text.ts`, `shared/contracts.ts`, `server/rpc/handlers.ts`, `server/hooks/inject-mcp.ts`, `test/hook.test.ts`
- Modify: `index.server.ts`

**Interfaces:**
- Produces:
  - text.ts: `afterStart(hooks: string[]): string`, `afterCloseCheck(problems: string[]): string`, `afterClose(prUrl: string | null, manual: string[]): string`, `afterNext(result: NextResult, spawned: { title: string } | null): string`, `nextPrompt(result: NextResult, extra?: string): string`, `closeInstructions(story: string, hooks: string[]): string`, `startInstructions(story: string): string`. The copy for `afterClose`, `nextPrompt`, and the `epic_close_check` paragraph is fixed by spec sections 6 and 8; the rest is one short paragraph each.
  - contracts.ts (zod, `defineRpc`): `statusRpc` (`{ workspaceDir: string; ref?: string }` → StatusResult), `checkRpc` (`{ workspaceDir; ref? }`), `initRpc` (`{ workspaceDir; epicId; title }`), `startRpc` (`{ workspaceDir; ref }` → StartResult), `closeRpc` (`{ workspaceDir; story }` → CloseResult), `nextRpc` (`{ workspaceDir; story?: string }` → NextResult plus `{ spawned: { workspaceId: string; agentId: string; title: string } | null; message: string }`), `isEpicRpc` (`{ workspaceDir }` → `{ epic: boolean }`). Names: `epic.status`, `epic.check`, `epic.init`, `epic.start`, `epic.close`, `epic.next`, `epic.isEpic`.
  - handlers.ts: `registerHandlers(server: PluginServerContext, deps: { spawnNext: SpawnNext })` wiring each contract to core; `nextRpc` with no `story` uses the last ledger entry of the single epic in the repo.
  - inject-mcp.ts: `buildMcpConfig(mcpPath: string, repoRoot: string, nodePath: string): McpStdioServerConfig` returning `{ type: "stdio", command: nodePath, args: [mcpPath, repoRoot], alwaysLoad: true }`; `injectEpicMcp(request: { config: AgentSessionConfig; env?: Record<string, string> }, opts: { mcpPath: string; nodePath: string; isEpicRepo: (cwd: string) => boolean; repoRoot: (cwd: string) => string }): typeof request | undefined` returns the request with `config.mcpServers.epic` set when `isEpicRepo(repoRoot(cwd))`, else `undefined`.
  - index.server.ts: resolves `mcpPath = fileURLToPath(new URL("./mcp/epic-mcp.mjs", import.meta.url))`, `nodePath = process.execPath`, registers `server.before("agent.create", ...)` using `injectEpicMcp` with `repoRoot(cwd)` = `git rev-parse --show-toplevel` (sync, falls back to `cwd`) and `isEpicRepo(root, loadConfig(root))`, then `registerHandlers`.

- [ ] **Step 1: Write the failing hook tests**

```ts
test("injects for an epic repo and its worktree", () => {
  const out = injectEpicMcp({ config: { provider: "claude", cwd: "/wt" } }, { mcpPath: "/p/mcp/epic-mcp.mjs", nodePath: "/usr/bin/node", isEpicRepo: () => true, repoRoot: () => "/wt" });
  expect(out?.config.mcpServers?.epic).toEqual({ type: "stdio", command: "/usr/bin/node", args: ["/p/mcp/epic-mcp.mjs", "/wt"], alwaysLoad: true });
});
test("keeps existing servers", () => { /* request has mcpServers.other; expect both keys */ });
test("does not inject for a non-epic repo", () => { expect(injectEpicMcp(req, { ...opts, isEpicRepo: () => false })).toBeUndefined(); });
test("isEpicRepo needs the status markers", () => { /* EPIC.md without markers → false; with markers → true */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/hook.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement text.ts, contracts.ts, handlers.ts, inject-mcp.ts, index.server.ts**

Handlers call core with `loadConfig(workspaceDir)` and catch `EpicError` to rethrow as a plain `Error` with the same message so the client shows it inline.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/hook.test.ts && npm run typecheck`
Expected: 4 passed; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add shared server index.server.ts test && git commit -m "feat(server): RPC contracts, handlers, instruction text and MCP injection hook"
```

---

### Task 7: The stdio MCP server and its bundle

**Files:**
- Create: `server/mcp/main.ts`, `mcp/epic-mcp.mjs` (generated, committed), `test/mcp.test.ts`

**Interfaces:**
- Consumes: core commands (Tasks 4 and 5), `text.ts` (Task 6).
- Produces: `main.ts` starts `McpServer` over `StdioServerTransport` with tools `epic_status`, `epic_start`, `epic_close_check`, `epic_close`, `epic_next`, `epic_check`; input schemas `{}`, `{ story: string }`, `{ story }`, `{ story }`, `{ story }`, `{ epic?: string }`. `process.argv[2]` is the repo root. Each tool returns one text content block: JSON of the result, a blank line, then the "what to do now" paragraph.
- Decision recorded here (deviation from spec section 6): the MCP server process cannot reach the daemon SDK, so `epic_next` runs `cmdNext` and ends its text with the sentence `Spawn pending for <next.story>: the plugin starts the successor now.` The plugin's `agent.turn_ended` hook (Task 8) performs the spawn and sends the agent the result. The agent and the human see the same outcome.

- [ ] **Step 1: Write the failing test**

```ts
test("mcp server lists tools and answers epic_check", async () => {
  const fx = new RemoteFixture(); await fx.setup(); await fx.planAndPush();
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["mcp/epic-mcp.mjs", fx.root] }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  expect(tools).toEqual(["epic_check", "epic_close", "epic_close_check", "epic_next", "epic_start", "epic_status"]);
  const res = await client.callTool({ name: "epic_check", arguments: { epic: "E99" } });
  expect((res.content as Array<{ text: string }>)[0].text).toContain("ok");
  await client.close(); fx.teardown();
});
```
`beforeAll` runs `execFileSync("npm", ["run", "build:mcp"])`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL, `server/mcp/main.ts` missing.

- [ ] **Step 3: Implement main.ts, then build**

Run: `npm run build:mcp && ls -la mcp/epic-mcp.mjs`
Expected: the file exists and is under 3 MB.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add server/mcp mcp test/mcp.test.ts && git commit -m "feat(mcp): stdio server exposing the epic tools, bundled with esbuild"
```

---

### Task 8: The `next` spawn with an injected SDK, and the turn-ended trigger

**Files:**
- Create: `server/rpc/next.ts`, `server/hooks/spawn-on-next.ts`, `test/next.test.ts`
- Modify: `server/rpc/handlers.ts`, `index.server.ts`

**Interfaces:**
- Produces:
  - next.ts: `type Spawned = { workspaceId: string; agentId: string; title: string }`; `type SpawnNext = (input: { root: string; story?: string }) => Promise<NextResult & { spawned: Spawned | null; message: string }>`; `createSpawnNext(deps: { paseo: PaseoApi; config: (root: string) => EpicConfig; next: typeof cmdNext; findWorkspaceByBranch: (branch: string) => Promise<{ id: string; directory: string } | null>; localBranchExists: typeof localBranchExists }): SpawnNext`.
    Algorithm (spec section 8): run `next`; if `next.next` is null return `{ ...result, spawned: null, message: afterNext(result, null) }`; if `findWorkspaceByBranch(next.branch)` returns a hit, return `spawned: { workspaceId: hit.id, agentId: "", title }` and a message saying the workspace already exists, without creating an agent; else `paseo.workspaces.create({ title: "<story> <title>", source: { kind: "worktree", cwd: root, action: "branch-off", baseBranch: next.baseRef, branchName: next.branch } })`; pick the profile from `(await paseo.config.get()).config.agentProfiles`: by `config.profile` matching `id` or `name`, else the first whose `notes` matches `/story|epic/i`, else none; agent config `{ provider: profile ? profile.provider + (profile.model ? "/" + profile.model : "") : "claude", modeId: profile?.modeId, thinkingOptionId: profile?.thinkingOptionId, featureValues: profile?.featureValues }`; `workspace.agents.create({ config, title: "<story> <title>", prompt: nextPrompt(result, cfg.hooks.nextPrompt), labels: { "epic.story": next.story } })`; return spawned `{ workspaceId: workspace.id, agentId: agent.id, title }`.
    `findWorkspaceByBranch` is implemented in handlers with `paseo.workspaces.list()`, filtering entries whose branch field equals the name; read the field name from `PaseoWorkspace` in `node_modules/@getpaseo/client/dist/index.d.ts` at implementation time.
  - spawn-on-next.ts: `pendingNextFromTimeline(timeline: readonly AgentTimelineItem[]): { story: string } | null` (finds the last `epic_next` tool call whose result text contains `Spawn pending for <id>`; tolerant of missing fields); `registerSpawnOnNext(server: PluginServerContext, deps: { spawnNext: SpawnNext; repoRoot: (cwd: string) => string })` subscribing `server.on("agent.turn_ended", ...)`: on a match, `spawnNext({ root: repoRoot(agent.cwd), story })` then `context.paseo.agents.ref(agent.id).send(message)`; errors are sent to the agent as text, never thrown.

- [ ] **Step 1: Write the failing tests**

With a fake `PaseoApi` (only `workspaces.create`, `workspaces.list`, `config.get`, and the returned workspace handle's `agents.create` recorded):
```ts
test("spawns the successor with the handoff prompt and the PR answers", async () => { /* fake next → TH-902 with one comment; expect workspaces.create called with source { kind: "worktree", action: "branch-off", baseBranch: "origin/epic/E99-test-epic", branchName: "feat/TH-902-second-thing" }; agents.create prompt contains "/epic start TH-902", "Answers from PR #7", the comment body, and the nextPrompt line; labels { "epic.story": "TH-902" } */ });
test("uses the named profile", async () => { /* config.get → agentProfiles [{ id: "story", name: "Story", provider: "claude", model: "opus", modeId: "bypassPermissions" }]; cfg.profile "story"; expect config.provider "claude/opus" and modeId "bypassPermissions" */ });
test("does not spawn twice", async () => { /* findWorkspaceByBranch returns null then a hit; two calls; expect agents.create called once */ });
test("closed epic spawns nothing", async () => { /* next.next null → spawned null; message contains "closed" */ });
test("pendingNextFromTimeline finds the epic_next call", () => { /* tool_call item named epic_next with result text "… Spawn pending for TH-902: …" → { story: "TH-902" }; a timeline without it → null */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/next.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement next.ts and spawn-on-next.ts, wire handlers and index.server.ts**

Read the tool-call item shape in `node_modules/@getpaseo/protocol/dist/agent-types.d.ts` (`AgentTimelineItem` with `type: "tool_call"`) to name the fields the matcher reads.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all passed; typecheck exits 0.

- [ ] **Step 5: Note the deviation in the spec and commit**

Append to spec section 6 one line: `Implementation note (2026-10-01): epic_next reports "Spawn pending"; the plugin's agent.turn_ended hook performs the spawn, since the MCP process has no daemon SDK.`

```bash
git add server index.server.ts test docs/superpowers/specs && git commit -m "feat(next): spawn the successor agent through the SDK, triggered by epic_next"
```

---

### Task 9: Client: Epic panel, slash command, Command Center item

**Files:**
- Create: `client/EpicPanel.tsx`, `client/strings.ts`, `test/strings.test.ts`
- Modify: `index.client.tsx`

**Interfaces:**
- Consumes: the contracts from `shared/contracts.ts`; `useRpc`, `useWorkspace(workspaceId, (w) => w.directory)`, `usePaseo`, `PluginWorkspacePanelProps` from `@getpaseo/plugin/client`.
- Produces:
  - `EpicPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps)`: on mount calls `isEpicRpc` then `statusRpc` with `workspaceDir` from `useWorkspace`; renders the layout from spec section 7: header line, state line, one row per story (Story, Lane, Status, Done), the open PR line, two `Pressable` buttons "Check" and "Start next story", and a result area that shows `problems`, the next `message`, or the error text. Not an epic: one line `This workspace has no epic package. Run /epic init E1 "Title".` Text colors `theme.colors.foreground` and `foregroundMuted`; buttons `theme.colors.accent` with `accentForeground`; padding `layout.compact ? 12 : 20`.
  - `client/strings.ts`: `startInstructions(story)` and `closeInstructions(story, hooks)` with the same text as `server/core/text.ts` (client code cannot import `server/`), plus panel labels.
  - index.client.tsx registers: `addWorkspacePanel({ id: "epic", title: "Epic", icon: "ListOrdered", context: "workspace", Component: EpicPanel })`; `addSlashCommand({ name: "epic", description: "Epic routine: init, start, close, next, check, status", argumentHint: "<verb> [id]", context: "workspace", onSubmit })` where `onSubmit` splits `args` into `verb` and `id`: `next`, `check`, `status`, `init` call the RPC with `workspace.directory` and then `openPanel("epic")`; `start` and `close` send the matching instruction text to the newest agent in the workspace (`paseo.agents.list({ cwd: workspace.directory })`, newest by `createdAt`, `paseo.agents.ref(id).send(text)`); an unknown verb throws `Error("Usage: /epic <init|start|close|next|check|status> [id]")`; `addCommandCenterItem({ id: "epic-next", title: "Epic: start next story", icon: "Play", context: "workspace", onSelect })` calling `nextRpc` then `openPanel("epic")`.

- [ ] **Step 1: Write the strings test**

```ts
test("client instruction text matches the server text", () => {
  expect(clientStrings.closeInstructions("TH-1", ["x"])).toBe(text.closeInstructions("TH-1", ["x"]));
  expect(clientStrings.startInstructions("TH-1")).toBe(text.startInstructions("TH-1"));
});
```

- [ ] **Step 2: Write the panel, strings, and registrations**

No unit tests for the React Native surface.

- [ ] **Step 3: Typecheck, the mobile audit, and the strings test**

Run: `npm run typecheck && rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/ index.client.tsx; npx vitest run test/strings.test.ts`
Expected: typecheck exits 0; `rg` prints nothing; 1 passed.

- [ ] **Step 4: Commit**

```bash
git add client index.client.tsx test/strings.test.ts && git commit -m "feat(client): Epic panel, /epic slash command and Command Center item"
```

---

### Task 10: Docs, install on the daemon, manual verification

**Files:**
- Create: `README.md`, `docs/README.md`, `docs/routine.md`, `docs/epic-yml.md`, `docs/VERIFICATION.md`

**Interfaces:**
- Consumes: everything.
- Produces: a plugin that reaches `running` on the user's daemon and passes the manual checks from spec section 10.

- [ ] **Step 1: Write the docs**

`docs/README.md` first paragraph states the single-user rule from spec section 1. Sections: what it is, install (`paseo plugin install github:<owner>/paseo-epic` and the npm form), enabling plugins with Paseo's trust warning, the routine in five lines, `.epic.yml`, the trigger table from spec section 7, the out-of-scope list. `docs/routine.md` holds the prose the tools quote, the same sentences as `server/core/text.ts`. `docs/epic-yml.md` documents each field with its default. Root `README.md` is three lines linking to `docs/README.md` and the spec.

- [ ] **Step 2: Enable plugins on the daemon, with permission**

Read `~/.paseo/config.json`; the root `pluginsEnabled` key is absent today. Ask the user with Paseo's warning text before setting it to `true`; then run `npx -y @getpaseo/cli@0.10.2 reload --json` and confirm `pluginsEnabled` in `appliedPaths`.

- [ ] **Step 3: Install and verify**

Run:
```bash
npx -y @getpaseo/cli@0.10.2 plugin install /Volumes/ExDrive/_sources/paseo-epic
npx -y @getpaseo/cli@0.10.2 plugin ls
npx -y @getpaseo/cli@0.10.2 plugin logs epic
```
Expected: `epic` is `running`, no error in logs.

Then in the Paseo app, in the inflow E100 worktree workspace: the Epic panel shows E100 with its rows and next story; `/epic status` opens the panel; `/epic` autocomplete offers the command; a new agent in that workspace lists tools `epic_status` and `epic_check` (ask it to call `epic_status`); the compact layout and a second theme render readable text. Record each check as a dated line in `docs/VERIFICATION.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs && git commit -m "docs: README, routine, .epic.yml reference and verification log"
```

---

## Self-review notes

- Spec coverage: sections 3 to 8 map to Tasks 2 to 9; section 9 to Task 1; sections 10 to 12 to Tasks 7 to 10. Section 13 (inflow migration) is deliberately not in this plan; it is a separate task after the plugin runs.
- Deviation from spec section 6 is recorded in Task 7 and written into the spec at Task 8.
- Type names used across tasks: `EpicConfig`, `StartResult`, `CloseResult`, `NextResult`, `StatusResult`, `SpawnNext`, `Spawned`, `EpicError`, `RemoteFixture`. Each is defined in the task that first produces it.
