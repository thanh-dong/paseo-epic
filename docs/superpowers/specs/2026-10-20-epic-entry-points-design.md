# Epic entry points: header button, Explorer panel, sidebar overview

Date: 2026-10-20. Status: draft for the owner's approval.

## Problem

The Epic panel has no fixed place in the Paseo UI. It opens only from
`/epic status` in the composer or from the Command Center item "Epic: start
next story", and that item also starts the next story. The owner could not
find the panel.

## Decision (owner, 2026-10-20)

Three entry points:

1. **Header button** in every workspace of an epic repo. Its label shows where
   the epic stands. Its menu opens things and **starts no work**.
2. **The panel also lives in the Explorer** (`locations: ["workspace", "explorer"]`).
3. **A sidebar footer item "Epics" opens an overview screen** that lists the
   epics of **all projects** on the host. The screen reads each epic from its
   **epic branch on origin** (as last fetched), so every worktree sees the same
   state. A Refresh button runs `git fetch`.

Nothing here adds a check or a rule (the plugin stays flow-only, spec
2026-10-20-flow-only-design.md).

```
 Sidebar                       Workspace header
 +----------------+            +-------------------------------------+
 | ...            |            |  ...   [E10 · next TH-E10-3 v] [..] |
 | [Epics]  <- 3  |            +-------------------------------------+
 +----------------+                  | menu  <- 1
        |                            +-- Open Epic panel   (tab)
        v                            +-- Open in Explorer  (side) <- 2
 +-- Epics screen ----------------+  +-- Epic overview     (screen 3)
 | sidera-engine                  |
 |  E10 Identity and reach        |
 |   in_progress · next TH-E10-3  |
 |   PR: none   [Workspace][Panel]|
 | [Refresh]  [Show closed]       |
 +--------------------------------+
```

## Platform

- Raise `@getpaseo/plugin` (dev dependency) from 0.10.2 to **0.12.0** and
  `requirements.paseo` in `paseo-plugin.json` to `>=0.12.0`. `addScreen` and
  `addSidebarFooterItem` are not in 0.10.2. The owner's app and daemon are
  0.12.0.
- Keep the other dev dependencies in step with what 0.12.0 expects
  (react-native, react, zod); `npm run typecheck` must pass.

## 1. Header button

**Which workspaces.** The client keeps a live workspace list with
`paseo.workspaces.list({ subscribe: {} })` (an owned subscription, released
on cleanup). For each workspace it asks the daemon once per directory whether
the directory is an epic repo (the existing `isEpicRpc`: `.epic.yml` or an epic
package). Epic repos get a button; others get none. A workspace that leaves the
list loses its button (`remove()`).

**Label.** A new RPC `headerRpc({ workspaceDir })` returns `{ epic, next }`:

- `epic`: the package `statusDir` picks for that checkout (its epic branch or
  story branch, else the newest open package).
- `next`: the `next=` of `HANDOFF.md` on `origin/<epic branch>` when that ref
  exists, else the local `next=`.

Label text: `E10 · next TH-E10-3`; `E10 · closed` when `next=none`; `Epic`
when the repo has `.epic.yml` but no package yet. The title (tooltip) is
"Epic". Icon `ListOrdered`. The label is read when the button is registered
and again on each update of that workspace from the subscription. It does not
poll.

**Menu** (`behavior: { kind: "menu" }`), no item that starts work:

| Item | Does |
| --- | --- |
| Open Epic panel | `openPanel("epic", { workspaceId, location: "workspace" })` |
| Open in Explorer | `openPanel("epic", { workspaceId, location: "explorer" })` |
| Epic overview | `openScreen({ screenId: "epic-overview" })` |

## 2. Explorer location

`addWorkspacePanel({ …, locations: ["workspace", "explorer"] })`. The panel
code does not change; it already lays itself out with `layout.compact`.

## 3. Sidebar footer item and overview screen

**Sidebar item.** `addSidebarFooterItem({ id: "epic-overview", title: "Epics",
Component })`. The component renders one `SidebarRow` (icon `ListOrdered`,
label "Epics"), active when `currentScreen` is the overview, and calls
`openScreen({ screenId: "epic-overview" })`.

**Screen.** `addScreen({ id: "epic-overview", title: "Epics", Component })`.

**Data.** The screen takes the workspace list (same subscription helper as the
header button), groups workspaces by `projectId`, and for each git project
calls a new RPC once:

`overviewRpc({ projectRoot, workspaces: [{ id, directory }], fetch })` →

```text
{ project, epics: [
    { epic, title, branch, state, next, after, rows: { total, open },
      openPr: { number, url, headRefName } | null,
      workspaceId: string | null } ] }
```

- Epics are the `origin/<epicBranchPrefix>*` refs (`git for-each-ref`), read
  with the existing `loadFromRef`: title from the H1, `state` from the Status
  block verbatim (display only), `next` / `after` from the handoff header,
  `rows` from the story table (`open` = rows whose status is `planned` or
  `in_progress`, display only).
- `openPr`: the open PR into the epic branch from `gh` when `gh` is there,
  else null. One `gh` call per epic.
- `workspaceId`: a workspace of the project whose checkout is on the epic
  branch or on a story branch of it (the daemon reads each directory's
  branch); else the workspace whose directory is `projectRoot`; else null.
- `fetch: true` runs `git fetch origin --prune` first (the Refresh button). The
  first load uses the refs as they are, so opening the screen is fast and
  offline-safe.
- A project with no epic branches is not shown. Non-git projects are skipped.

**Layout.** One section per project (display name), one card per epic, newest
epic first. A card shows `E10 Identity and reach`, `state · next TH-E10-3`,
`stories: 2 of 7 open` style counts, the open PR as a link, and two buttons:
**Open workspace** and **Open panel** (both need `workspaceId`; hidden when
null). Epics whose `next` is `none` are hidden unless **Show closed** is on.
Toolbar: **Refresh** (runs `fetch: true` for every project), **Show closed**
toggle. Errors per project show inline in that section; one failing project
does not hide the others.

## Out of scope

- No new command that starts work (Start next stays in the panel and ⌘K).
- No polling. No cross-host aggregation (the screen lists the selected host).
- No change to the epic package format or the flow.

## Tests

- Core: `overview` on a fixture repo with a bare remote and two epic branches
  (one open, one `next=none`), including a commented ledger example and a
  missing HANDOFF.md on one branch (that epic shows with `next` empty, not an
  error for the project).
- `headerLabel(epic, next)` text cases; `headerRpc` picks origin over local.
- A pure reducer that turns (workspace list, isEpic answers) into
  add / update / remove of header buttons; the client calls it.
- `workspaceId` matching: epic branch, story branch, project root, none.
- Contracts: `overviewRpc`, `headerRpc` round-trip.
- Live, by hand (docs/VERIFICATION.md rows): the header button appears in an
  epic repo workspace and not in another; each menu item; the panel in the
  Explorer; the sidebar item and the screen with Refresh and Show closed; a
  compact (mobile) layout.
- `npm run typecheck`, `npm test`, `npm run build:mcp` (the bundle must match).
