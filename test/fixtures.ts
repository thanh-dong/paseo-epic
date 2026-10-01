import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEpic } from "../server/core/parse";
import { renderStatus } from "../server/core/check";
import { slugify, today } from "../server/core/slug";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));

export const TODAY = today();

export const ROWS = `| TH-901 First thing | Builds the first thing. | normal | implemented | 2026-09-06 PR #1 |
| TH-902 Second thing | Builds the second thing. | normal | planned | |
| TH-903 Third thing | Builds the third thing. | high-risk | planned | |`;

export const LEDGER_901 = `
### TH-901 — 2026-09-06

- Branch / PR: \`feat/TH-901-first-thing\`, PR #1 into \`epic/E99-test-epic\`.
- Shipped: \`apps/server/src/one.ts\` (new).
- Decisions: none.
- Deviations: none.
- Effects on later stories: none.
`;

/** A fake repo root with the plugin's templates copied in. */
export function makeRoot(tmp: string): string {
  mkdirSync(join(tmp, "docs", "templates"), { recursive: true });
  for (const name of ["epic.md", "handoff.md"]) {
    cpSync(join(TEMPLATES, name), join(tmp, "docs", "templates", name));
  }
  mkdirSync(join(tmp, "docs", "stories", "epics"), { recursive: true });
  return tmp;
}

/**
 * Write the E99 package from the templates the way `epic.py init --no-git`
 * does (cmdInit arrives in a later task). Returns the package dir.
 */
export function initE99(root: string): string {
  const epicId = "E99";
  const title = "Test epic";
  const name = `${epicId}-${slugify(title)}`;
  const d = join(root, "docs", "stories", "epics", name);
  mkdirSync(d, { recursive: true });
  const tpl = join(root, "docs", "templates");
  const epicText = readFileSync(join(tpl, "epic.md"), "utf8")
    .replaceAll("ENN-slug", name)
    .replaceAll("# ENN — Epic title", `# ${epicId} — ${title}`)
    .replaceAll("ENN", epicId);
  const handoffText = readFileSync(join(tpl, "handoff.md"), "utf8")
    .replaceAll("ENN-slug", name)
    .replaceAll("ENN — Epic title", `${epicId} — ${title}`)
    .replaceAll("ENN", epicId)
    .replaceAll("written=YYYY-MM-DD", `written=${today()}`);
  writeFileSync(join(d, "EPIC.md"), epicText);
  writeFileSync(join(d, "HANDOFF.md"), handoffText);
  return d;
}

/** Init E99, put rows/ledger/handoff in, render the status. */
export function fill(
  root: string,
  opts: { rows?: string; ledger?: string; after?: string; next?: string } = {},
): string {
  const { rows = ROWS, ledger = LEDGER_901, after = "TH-901", next = "TH-902" } = opts;
  const d = initE99(root);
  const f = join(d, "EPIC.md");
  const text = readFileSync(f, "utf8")
    .replaceAll(
      "| TH-NNN Story title | What it builds, in one or two sentences. | normal | planned | |",
      rows,
    )
    .replaceAll("## Dependencies", `${ledger}\n## Dependencies`);
  writeFileSync(f, renderStatus(parseEpic(f, text)));
  const h = join(d, "HANDOFF.md");
  writeFileSync(
    h,
    readFileSync(h, "utf8").replaceAll(
      `after=none next=none written=${TODAY}`,
      `after=${after} next=${next} written=${TODAY}`,
    ),
  );
  return d;
}
