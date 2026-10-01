# ENN handoff

<!-- handoff: epic=ENN after=none next=none written=YYYY-MM-DD -->

<!--
  Handoff template (docs/templates/handoff.md). Rewritten WHOLE at every
  `/epic close`; never appended. About one page. This is the only file a
  fresh session needs to read before starting the next story; `/epic start`
  prints it and refuses when the header's `next=` is not the story being
  started or `after=` is not the last Ledger entry in EPIC.md.

  Keep the five numbered headings. Use real paths, real symbol names, real
  ADR ids. No "see above", no history — history lives in EPIC.md §Ledger.
-->

## 1. Epic state

- Epic: ENN — Epic title. Branch `epic/ENN-slug`, N commits behind `main`.
- Stories: N of M implemented. Next: TH-NNN.
- Open PR: none | #N (must be merged before the next story starts).

## 2. Last story: what shipped

Story: none yet — the epic was just planned. | TH-NNN Title, PR #N.

One short paragraph: what the story made true.

| Path | Change |
| --- | --- |
| `apps/server/src/…` | new: … |
| `packages/api/src/…` | changed: … |

- New routes / functions / tables / migrations: `name` (`path`), …
- ADRs: TH-0NNN accepted with the story; …
- Deviations from the plan: … | none.
- Tests added and how to run them:
  ```
  cd apps/server && bun run test src/…/x.test.ts
  ```
- Environment: migrations `0NNN` applied to the dev database; seed …; env …

## 3. Plan changes

- TH-MMM row edited: … (why).
- Open question N resolved: … | none.

## 4. Next story brief

- Story: TH-NNN Title. Packet: `docs/stories/epics/ENN-slug/TH-NNN-slug/`. Lane: normal.
- Goal: …
- Builds on: `path` (`symbol`) from TH-PPP; …
- Acceptance criteria:
  - …
- Constraints: intake gate first (`scripts/bin/harness-cli query matrix`);
  lane rules; Inflow design system for any UI; ADRs inside the story are
  accepted with it (TH-0193).
- Read first: `docs/stories/epics/ENN-slug/EPIC.md` §Design decisions,
  `design/…`, ADR …
- Build order: the pieces and which depends on which (input for the next
  agent's own plan; not a working procedure).

## 5. Gotchas

- … (from implementation-notes.html and the trace of the last story)
