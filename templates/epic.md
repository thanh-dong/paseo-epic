# ENN — Epic title

<!--
  Epic package template (docs/templates/epic.md). Create with
  `python3 scripts/epic.py init ENN "Epic title"` — do not copy by hand.

  Three sections are machine-read by scripts/epic.py; keep their shape:
    ## Status      the block between the epic-status markers (rewritten whole)
    ## Story list  the table; row order IS the build order; the first cell
                   starts with the story id (`TH-652 Title`)
    ## Ledger      one `### TH-652 — YYYY-MM-DD` entry per finished story,
                   appended in the order stories closed
  Everything else is planning content, mostly frozen after planning.
  History never goes into ## Status. It goes into ## Ledger.
  The brief for the next fresh session is HANDOFF.md next to this file.
-->

## Status

<!-- epic-status:begin -->
State: planned
Branch: epic/ENN-slug
Stories: 0 of 0 implemented
Next: none
<!-- epic-status:end -->

## Goal

One paragraph. What is true for the user when this epic is closed.

## Source of truth

- `design/…` — the design agreed on YYYY-MM-DD.
- Product docs this epic changes.

## Design decisions

| # | Decision | Where it lives |
| --- | --- | --- |
| 1 | | ADR / design file |

## Scope

In scope:

- …

Out of scope:

- …

## Story list

Row order is the build order. `Status` is one of `planned`, `in_progress`,
`implemented`, `dropped`. `Done` is `YYYY-MM-DD PR #N` once implemented.

| Story | Description | Lane | Status | Done |
| --- | --- | --- | --- | --- |
| TH-NNN Story title | What it builds, in one or two sentences. | normal | planned | |

## Ledger

One entry per finished story, appended at `/epic close`, newest last. Fixed
shape; the same facts feed `HANDOFF.md` §2.

<!--
### TH-NNN — YYYY-MM-DD

- Branch / PR: `feat/TH-NNN-slug`, PR #N into `epic/ENN-slug`.
- Shipped: `path/one.ts` (new …), `path/two.ts` (changed …).
- Decisions: ADR TH-0NNN accepted with the story; …
- Deviations: what the plan said vs what shipped, and why.
- Effects on later stories: TH-MMM row edited (…); none.
-->

## Dependencies

- Upstream: …
- Downstream: …

## Validation outline

| Layer | Expected proof |
| --- | --- |
| Unit | |
| Integration | |
| E2E | |
| Platform | |
| Release | |

## Open questions

1. … (owned by TH-NNN)

## Notes

Anything that does not fit above.
