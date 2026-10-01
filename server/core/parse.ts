import { dirname } from "node:path";
import {
  type EpicPackage,
  type Handoff,
  type Row,
  STATUS_BEGIN,
  STATUS_END,
  STORY_ID_RE,
} from "./types";

const H1_RE = /^#\s+(E\d+)\s*[—–-]\s*(.+?)\s*$/m;
const LEDGER_RE = /^###\s+([A-Z]{2,}-\d+)\s*[—–-]\s*(\S+)/;
const HANDOFF_RE = /<!--\s*handoff:\s*epic=(\S+)\s+after=(\S+)\s+next=(\S+)\s+written=(\S+)\s*-->/;

/** Python's str.splitlines(): no trailing empty element, "" gives []. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function parseEpic(path: string, text: string): EpicPackage {
  const epic: EpicPackage = {
    path,
    dir: dirname(path),
    text,
    id: "",
    title: "",
    status: {},
    statusSpan: null,
    rows: [],
    ledger: [],
  };
  const h1 = H1_RE.exec(text);
  if (h1) {
    epic.id = h1[1];
    epic.title = h1[2];
  }
  const lines = splitLines(text);
  const b = lines.indexOf(STATUS_BEGIN);
  const e = b >= 0 ? lines.indexOf(STATUS_END, b) : -1;
  if (b >= 0 && e >= 0) {
    epic.statusSpan = [b, e];
    for (const line of lines.slice(b + 1, e)) {
      const colon = line.indexOf(":");
      if (colon >= 0) {
        epic.status[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }
  }
  epic.rows = parseRows(lines);
  for (const line of section(lines, "## Ledger")) {
    const m = LEDGER_RE.exec(line);
    if (m) epic.ledger.push({ id: m[1], date: m[2] });
  }
  return epic;
}

/** The lines under `## heading`, up to the next `## ` heading. */
export function section(lines: string[], heading: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inside = line.trim() === heading;
      continue;
    }
    if (inside) out.push(line);
  }
  return out;
}

function parseRows(lines: string[]): Row[] {
  const rows: Row[] = [];
  let inside = false;
  let inComment = false;
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      inside = line.trim() === "## Story list";
      return;
    }
    if (!inside) return;
    if (line.includes("<!--")) inComment = true;
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      return;
    }
    if (!line.startsWith("|")) return;
    const cells = line
      .trim()
      .replace(/^\|+|\|+$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 4 || /^[- ]*$/.test(cells[0]) || cells[0] === "Story") return;
    const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(cells[0]);
    if (!first || !STORY_ID_RE.test(first[1])) return;
    rows.push({
      id: first[1],
      title: first[2] ?? "",
      lane: cells[2],
      status: cells[3],
      done: cells.length > 4 ? cells[4] : "",
      lineNo: i,
    });
  });
  return rows;
}

export function parseHandoff(text: string): Handoff {
  const h: Handoff = { text, found: false, epic: "", after: "", next: "", written: "" };
  const m = HANDOFF_RE.exec(text);
  if (m) {
    h.found = true;
    [, h.epic, h.after, h.next, h.written] = m;
  }
  return h;
}

/** The `### <story> …` entry under `## Ledger`, heading included, trimmed. */
export function ledgerEntry(text: string, story: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of section(splitLines(text), "## Ledger")) {
    if (line.startsWith("### ")) {
      inside = line.startsWith(`### ${story} `);
      if (inside) out.push(line);
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}
