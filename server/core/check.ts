import { basename } from "node:path";
import { splitLines } from "./parse";
import {
  DATE_RE,
  type EpicPackage,
  EpicError,
  HANDOFF_HEADINGS,
  type Handoff,
  OPEN_ROW,
  ROW_STATUSES,
  type Row,
  STATES,
  STATUS_BEGIN,
  STATUS_END,
} from "./types";

/** Python's repr of a tuple of strings, kept so problem text matches epic.py. */
function pyTuple(items: readonly string[]): string {
  return `(${items.map((s) => `'${s}'`).join(", ")})`;
}

export function epicBranch(epic: EpicPackage): string {
  return epic.status.Branch || `epic/${basename(epic.dir)}`;
}

export function rowOf(epic: EpicPackage, id: string): Row | undefined {
  return epic.rows.find((r) => r.id === id);
}

export function expectedNext(epic: EpicPackage): string {
  return epic.rows.find((r) => OPEN_ROW.includes(r.status))?.id ?? "none";
}

export function counts(epic: EpicPackage): [number, number] {
  const live = epic.rows.filter((r) => r.status !== "dropped");
  return [live.filter((r) => r.status === "implemented").length, live.length];
}

export function expectedState(epic: EpicPackage): "planned" | "in_progress" | "closed" {
  if (epic.rows.length === 0) return "planned";
  if (!epic.rows.some((r) => OPEN_ROW.includes(r.status))) return "closed";
  if (epic.rows.some((r) => r.status === "implemented" || r.status === "in_progress")) {
    return "in_progress";
  }
  return "planned";
}

export function checkPackage(epic: EpicPackage, handoff: Handoff | null): string[] {
  const p: string[] = [];
  const has = (key: string) => Object.hasOwn(epic.status, key);
  const dirName = basename(epic.dir);
  const folderId = dirName.split("-")[0];
  if (!epic.id) {
    p.push("EPIC.md: H1 must be `# Eid — Title`");
  } else if (epic.id !== folderId) {
    p.push(`EPIC.md: H1 id ${epic.id} does not match folder ${dirName}`);
  }
  if (epic.statusSpan === null) {
    p.push("EPIC.md: Status block markers missing (epic-status:begin/end)");
  }
  for (const key of ["State", "Branch", "Stories", "Next"]) {
    if (!has(key)) p.push(`EPIC.md: Status block lacks \`${key}:\``);
  }
  const state = has("State") ? epic.status.State : "";
  if (state && !STATES.includes(state)) {
    p.push(`EPIC.md: State \`${state}\` not in ${pyTuple(STATES)}`);
  }
  const branch = has("Branch") ? epic.status.Branch : "";
  if (branch && !branch.startsWith("epic/")) {
    p.push(`EPIC.md: Branch \`${branch}\` must start with epic/`);
  }

  const seen = new Set<string>();
  for (const r of epic.rows) {
    if (seen.has(r.id)) p.push(`EPIC.md: story ${r.id} listed twice`);
    seen.add(r.id);
    if (!ROW_STATUSES.includes(r.status)) {
      p.push(`EPIC.md: ${r.id} status \`${r.status}\` not in ${pyTuple(ROW_STATUSES)}`);
    }
    if (r.status === "implemented" && !r.done) {
      p.push(`EPIC.md: ${r.id} is implemented but the Done cell is empty`);
    }
  }
  const ledgerIds = epic.ledger.map((l) => l.id);
  for (const r of epic.rows) {
    if (r.status === "implemented" && !ledgerIds.includes(r.id)) {
      p.push(`EPIC.md: ${r.id} is implemented but has no \`### ${r.id} — date\` ledger entry`);
    }
  }
  for (const { id, date } of epic.ledger) {
    const row = rowOf(epic, id);
    if (row === undefined) {
      p.push(`EPIC.md: ledger entry ${id} is not in the story list`);
    } else if (row.status !== "implemented") {
      p.push(`EPIC.md: ledger entry ${id} exists but the row is \`${row.status}\``);
    }
    if (!DATE_RE.test(date)) {
      p.push(`EPIC.md: ledger entry ${id} date \`${date}\` is not YYYY-MM-DD`);
    }
  }

  const [done, total] = counts(epic);
  const want = `${done} of ${total} implemented`;
  const stories = has("Stories") ? epic.status.Stories : "";
  if (stories && stories !== want) {
    p.push(`EPIC.md: Stories \`${stories}\` should be \`${want}\` (run render)`);
  }
  const expNext = expectedNext(epic);
  const next = has("Next") ? epic.status.Next : "";
  if (next && next !== expNext) {
    p.push(`EPIC.md: Next \`${next}\` should be \`${expNext}\` (first open row)`);
  }
  const expState = expectedState(epic);
  if (state && state !== expState) {
    p.push(`EPIC.md: State \`${state}\` should be \`${expState}\` from the story table`);
  }

  if (handoff === null) {
    p.push("HANDOFF.md missing");
    return p;
  }
  if (!handoff.found) {
    p.push("HANDOFF.md: header `<!-- handoff: epic=… after=… next=… written=… -->` missing");
    return p;
  }
  if (handoff.epic !== epic.id) {
    p.push(`HANDOFF.md: epic=${handoff.epic} but this is ${epic.id}`);
  }
  const last = ledgerIds.length > 0 ? ledgerIds[ledgerIds.length - 1] : "none";
  if (handoff.after !== last) {
    p.push(`HANDOFF.md: after=${handoff.after} but the last ledger entry is ${last}`);
  }
  if (handoff.next !== expNext) {
    p.push(`HANDOFF.md: next=${handoff.next} but the next open story is ${expNext}`);
  }
  if (!DATE_RE.test(handoff.written)) {
    p.push(`HANDOFF.md: written=${handoff.written} is not YYYY-MM-DD`);
  }
  const handoffLines = splitLines(handoff.text);
  for (const h of HANDOFF_HEADINGS) {
    if (!handoffLines.some((line) => line.startsWith(h))) {
      p.push(`HANDOFF.md: heading \`${h} …\` missing`);
    }
  }
  return p;
}

/** Return EPIC.md text with the Status block rewritten from the table. */
export function renderStatus(epic: EpicPackage): string {
  if (epic.statusSpan === null) {
    throw new EpicError("cannot render: Status block markers missing");
  }
  const [done, total] = counts(epic);
  const block = [
    STATUS_BEGIN,
    `State: ${expectedState(epic)}`,
    `Branch: ${epicBranch(epic)}`,
    `Stories: ${done} of ${total} implemented`,
    `Next: ${expectedNext(epic)}`,
    STATUS_END,
  ];
  const lines = splitLines(epic.text);
  const [b, e] = epic.statusSpan;
  const out = [...lines.slice(0, b), ...block, ...lines.slice(e + 1)];
  return out.join("\n") + (epic.text.endsWith("\n") ? "\n" : "");
}
