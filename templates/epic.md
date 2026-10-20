# ENN — Epic title

<!--
  Epic package template. epic_init writes it; a repo can ship its own with
  the `templates:` key in .epic.yml.

  paseo-epic reads three parts and checks none of them. The repo's own
  checks, named in the .epic.yml hooks, own the rules.
    ## Status      the lines between the epic-status markers, shown as they are
    ## Story list  the table; row order is the build order; the first cell
                   starts with the story id (`S-1 Title`)
    ## Ledger      one `### S-1 — YYYY-MM-DD` entry per finished story; the
                   entry is the body of the story PR
  Comment blocks like this one are skipped.
  The brief for the next story is HANDOFF.md next to this file.
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

## Design decisions

| # | Decision | Where it lives |
| --- | --- | --- |
| 1 | | |

## Scope

In scope:

- …

Out of scope:

- …

## Story list

Row order is the build order. The Epic panel marks `in_progress` and
`implemented` rows.

| Story | Description | Lane | Status | Done |
| --- | --- | --- | --- | --- |
| S-1 Story title | What it builds, in one or two sentences. | normal | planned | |

## Ledger

One entry per finished story, newest last.

<!--
### S-1 — YYYY-MM-DD

- What shipped, what changed in the plan, and what later stories need to know.
-->

## Dependencies

- Upstream: …
- Downstream: …

## Open questions

1. …

## Notes

Anything that does not fit above.
