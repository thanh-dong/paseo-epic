import { basename, dirname } from "node:path";
import { type EpicPackage, type Handoff, type Row, STATUS_BEGIN, STATUS_END } from "./types";

const HANDOFF_RE = /<!--\s*handoff:\s*epic=(\S+)\s+after=(\S+)\s+next=(\S+)\s+written=(\S+)\s*-->/;
/** A table separator row: `| --- | :---: |`. */
const SEPARATOR_RE = /^\|[\s|:-]*-[\s|:-]*$/;

/** Python's str.splitlines(): no trailing empty element, "" gives []. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The epic id: the package folder name before its first `-`. */
export function folderEpicId(dir: string): string {
  return basename(dir).split("-")[0];
}

/**
 * `lines` with every `<!-- -->` block blanked to "", so line indexes stay.
 * A block starts on a line holding `<!--` and ends on a line holding `-->`.
 */
export function uncommented(lines: string[]): string[] {
  let inComment = false;
  return lines.map((line) => {
    if (line.includes("<!--")) inComment = true;
    if (!inComment) return line;
    if (line.includes("-->")) inComment = false;
    return "";
  });
}

export function parseEpic(path: string, text: string): EpicPackage {
  const dir = dirname(path);
  const epic: EpicPackage = { path, dir, text, id: folderEpicId(dir), title: "", status: {}, rows: [] };
  const lines = splitLines(text);
  const h1 = lines.find((line) => /^#\s/.test(line));
  if (h1) {
    // The title is the H1 after the id and a dash, when the H1 starts with them.
    const heading = h1.replace(/^#\s+/, "").trim();
    const afterId = heading.startsWith(epic.id) ? heading.slice(epic.id.length) : "";
    const m = /^\s*[—–-]\s*(.+)$/.exec(afterId);
    epic.title = m ? m[1].trim() : heading;
  }
  const b = lines.indexOf(STATUS_BEGIN);
  const e = b >= 0 ? lines.indexOf(STATUS_END, b) : -1;
  if (b >= 0 && e >= 0) {
    for (const line of lines.slice(b + 1, e)) {
      const colon = line.indexOf(":");
      if (colon >= 0) {
        epic.status[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }
  }
  epic.rows = parseRows(lines);
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

/** The rows of the `## Story list` table: the id is the first word of the first cell. */
function parseRows(lines: string[]): Row[] {
  const rows: Row[] = [];
  let inside = false;
  const clean = uncommented(lines);
  clean.forEach((line, i) => {
    if (line.startsWith("## ")) {
      inside = line.trim() === "## Story list";
      return;
    }
    if (!inside || !line.startsWith("|")) return;
    // The separator, and the header row right above it, are not stories.
    if (SEPARATOR_RE.test(line.trim()) || SEPARATOR_RE.test((clean[i + 1] ?? "").trim())) return;
    const cells = line
      .trim()
      .replace(/^\|+|\|+$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 4) return;
    const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(cells[0]);
    if (!first) return;
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

export function rowOf(epic: EpicPackage, id: string): Row | undefined {
  return epic.rows.find((r) => r.id === id);
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

/** The `### <story> …` entry under `## Ledger`, heading included, trimmed; comment blocks skipped. */
export function ledgerEntry(text: string, story: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of uncommented(section(splitLines(text), "## Ledger"))) {
    if (line.startsWith("### ")) {
      inside = line === `### ${story}` || line.startsWith(`### ${story} `);
      if (inside) out.push(line);
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}
