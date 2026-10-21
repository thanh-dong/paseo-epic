# Plan: Epic entry points

Spec: `docs/superpowers/specs/2026-10-20-epic-entry-points-design.md`.
Branch: `feat/epic-entry-points` from `main` (`e77cf88`). Test first in every
task; each task ends green on `npm run typecheck` and `npm test`.

## Tasks

1. **SDK 0.12.0.** Raise `@getpaseo/plugin` to 0.12.0 and
   `requirements.paseo` to `>=0.12.0`; align react / react-native / zod with the
   SDK's peer ranges; fix any type break from the upgrade (no behavior change).
   Proof: typecheck and the 140 existing tests pass.

2. **Explorer location.** `locations: ["workspace", "explorer"]` on the panel.
   Proof: a test on the contribution object (the `contribute()` registration
   list) that the panel carries both locations.

3. **Daemon: `headerRpc`.** Core function `headerInfo(root, config)` →
   `{ epic, next }` (statusDir's package; `next=` from `origin/<branch>` when
   the ref exists, else local). Contract in `shared/contracts.ts`, handler in
   `server/rpc/handlers.ts`. Proof: git fixture tests (origin ahead of local;
   no origin ref; `.epic.yml` without a package).

4. **Client: header buttons.** `client/header.ts`:
   - `headerLabel(info)` (pure): `E10 · next TH-E10-3` / `E10 · closed` / `Epic`.
   - `planButtons(previous, workspaces, isEpicByDir)` (pure reducer) → adds,
     updates, removes.
   - `startHeaderButtons(client)`: owns the `workspaces.list({ subscribe: {} })`
     subscription, caches `isEpic` per directory, applies the reducer with
     `addHeaderButton` / `update` / `remove`, and returns a cleanup that
     releases the subscription and removes every button.
   - The menu: Open Epic panel, Open in Explorer, Epic overview.
   Proof: unit tests for `headerLabel` and `planButtons`; a test with a fake
   client that the cleanup removes every button and releases the subscription.

5. **Daemon: `overviewRpc`.** Core function `overview(projectRoot, config,
   workspaces, { fetch })`: list `origin/<epicBranchPrefix>*`, read each with
   `loadFromRef`, build the card fields, match `workspaceId`, add `openPr` via
   `gh` when available. Contract and handler. Proof: fixture repo with a bare
   remote and two epic branches (open and `next=none`), a commented ledger
   example, one branch without HANDOFF.md; `workspaceId` cases (epic branch,
   story branch, project root, none); `fetch: true` picks up a new remote
   branch.

6. **Client: sidebar item and screen.** `client/EpicOverview.tsx` (screen) and
   `client/EpicsSidebarItem.tsx` (`SidebarRow`). The screen uses the shared
   workspace subscription helper from task 4, groups by `projectId`, calls
   `overviewRpc` per git project, renders sections and cards, Refresh and Show
   closed, inline errors per project. Register with `addScreen` and
   `addSidebarFooterItem` in `index.client.tsx`. Colors from `theme.colors`,
   spacing from `layout.compact`. Proof: tests for the pure grouping and
   filtering helpers (closed hidden, newest first, error per project).

7. **Docs.** README "Where to find it" (header button, Explorer, sidebar
   Epics, `/epic status`), docs/README.md panel and screen sections,
   docs/VERIFICATION.md rows for the live checks. Remove the "no fixed place"
   limitation.

8. **Bundle and checks.** `npm run build:mcp`; tree clean; `npm run
   typecheck`; `npm test`. Draft PR in `thanh-dong/paseo-epic`.

9. **Live check after install** (owner's machine): `paseo plugin update epic
   --ref <head>` with `/Applications/Paseo.app/Contents/Resources/bin/paseo`;
   walk the VERIFICATION rows on desktop, and the compact layout in a narrow
   window.

## Order and risk

- Task 1 first: everything else needs the 0.12.0 API.
- Tasks 3 and 5 (daemon) are independent of tasks 4 and 6 (client) apart from
  the contracts; contracts land with the daemon task.
- Risk: the workspace list subscription and per-workspace button registration
  are new to this plugin. Keep all of it in `client/header.ts` behind one
  start/cleanup pair so a reload leaves no stale buttons.
- Risk: one `gh` call per epic on the overview. It runs only when the screen
  loads or Refresh is pressed; a missing `gh` gives `openPr: null`.

## Deviations (implementation, 2026-10-20)

Each one keeps the owner's three decisions: all projects, the epic branches
on origin as the data source, and a header menu with no item that starts
work.

1. **`headerRpc` is the per-directory gate, not `isEpicRpc`.** `isEpicRpc`
   answers true only for an epic package; a repo with `.epic.yml` alone is
   false, so it could never show the `Epic` label. Widening it would change
   the panel (it would call status and show "no epic package; run init
   first" as an error instead of its no-epic text). So `headerRpc` returns
   `null` for a repo with neither `.epic.yml` nor a package, and
   `{ epic: null, next: "" }` for `.epic.yml` alone. One RPC per directory
   instead of two. `isEpicRpc` is unchanged.
2. **Label without a handoff header.** When the handoff has no header (or
   there is no HANDOFF.md), `next` is `""` and the label is the epic id
   alone (`E10`). The spec did not cover this case.
3. **`planButtons` takes a fourth argument, `changed`.** Only the workspaces
   a list change is about are re-labelled (every workspace on a snapshot,
   one on an update), so an update of one workspace does not re-read every
   label.
4. **The screen's Open panel.** `PluginScreenProps` has no `openPanel`, so
   `makeEpicOverview(openPanel)` closes over `client.openPanel`.
5. **The PR link on the screen** uses `navigation.openBrowser` when the card
   has a workspace, else the URL is selectable text, as in the panel.
   `openExternalUrl` is declared in the 0.12.0 types but is not in the
   package's `client/index.js`, so it is not used.
6. **An origin epic branch with no `EPIC.md`** is no epic and is left out of
   the overview, not an error for the project. The spec covered only a
   missing `HANDOFF.md` (next shows empty).
7. **Small shape choices.** `overviewRpc` returns `project` as the project
   root it was called with; its `fetch` input is optional. The menu items
   carry no icons (a bad Lucide name throws; the titles are enough). Under a
   project whose closed epics are hidden, a muted line says how many are
   hidden, so a project with only closed epics does not look empty.
8. **Mobile audit.** Client generics use named id types (`WorkspaceId`,
   `ProjectId`, `Dir`) so the audit's HTML-tag pattern does not match
   `Set<string>`. The one remaining hit is the old `noEpic` text in
   `client/strings.ts`.
9. **"No fixed place" limitation.** Neither README nor docs/README.md had
   that text, so nothing was removed. The README "Manual checks" bullet now
   names the new live checks.
10. **Lockfile.** `npm install` of 0.12.0 also dropped the nested
    `vitest/node_modules/esbuild` (0.28.2) entries; the root esbuild 0.25.12
    builds the MCP bundle and the bundle did not change.
11. **Task 8.** No draft PR: this run does not push.

## Changes after code review (2026-10-21)

All accepted from the review of `feat/epic-entry-points`.

- **A. Paging.** The daemon pages the subscription snapshot at 200. The
  watcher keeps the snapshot's `pageInfo` and, while `hasMore`, reads the
  next pages with plain `workspaces.list({ page: { limit: 200, cursor } })`.
  It adds only ids it does not know yet, so an entry an update already
  brought keeps its newer data. A new snapshot (reconnect) ends the reads of
  the old one.
- **B. Project-root match.** `matchWorkspace` compares `resolve()`d paths,
  so `/repo/` matches `/repo`.
- **C. Rate.** A label is read again 2 s after the last update of that
  workspace (trailing debounce per workspace); `labelSeq` still drops stale
  reads. Five updates within a second give one read.
- **D. Errors are not cached.** A failed `epic.header` ask keeps no answer;
  the next list change of that workspace asks again. Directories are asked
  only for the workspaces a change is about (all of them on a snapshot).
  Successful answers, `null` included, are kept.
- **E. Screen staleness.** The screen reads a project again when its set of
  workspace ids changes (`workspaceKey`, `groupsToRead`). Before the first
  workspace list, and while a project has no answer, it shows "Reading the
  epic branches…", never "No project … has an epic branch".
- **F. Fan-out.** One `gh pr list --state open --limit 100 --json
  number,url,headRefName,baseRefName` per project, grouped by `baseRefName`
  (`prsByBase`). The per-branch git reads and the per-workspace branch reads
  run at most 4 at a time (a local `mapLimit`). `--limit 100` is added
  because `gh pr list` lists 30 by default.
- **G. gh output.** Any gh failure, a JSON parse error included, gives no PR
  links; it never fails the project.
- **H. Release.** `subscription.release()` is called as
  `release().catch(() => {})`.
- **I. One subscription.** `index.client.tsx` starts one watcher
  (`watchWorkspaces` now returns `{ listen, stop }`). The header buttons and
  every open Epics screen listen to it; a listener added after the first
  snapshot gets the list at once. Its `stop()` is in the contribute cleanup
  list. The screen therefore reads the workspace list through the client's
  `paseo`, not `usePaseo()`; rows 35 and 36 check host switches and that
  closing the screen does not end the subscription.

The paging risk named for the live check is handled by A.
