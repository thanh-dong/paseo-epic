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
