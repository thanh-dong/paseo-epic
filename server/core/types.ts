import type { NextResult } from "./commands";

/** A refusal with a message for the human. */
export class EpicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpicError";
  }
}

export const STATUS_BEGIN = "<!-- epic-status:begin -->";
export const STATUS_END = "<!-- epic-status:end -->";
export const STATES: readonly string[] = ["planned", "in_progress", "closed"];
export const ROW_STATUSES: readonly string[] = ["planned", "in_progress", "implemented", "dropped"];
export const OPEN_ROW: readonly string[] = ["planned", "in_progress"];
export const HANDOFF_HEADINGS: readonly string[] = ["## 1.", "## 2.", "## 3.", "## 4.", "## 5."];

export const EPIC_ID_RE = /^E\d+$/;
export const STORY_ID_RE = /^[A-Z]{2,}-\d+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface Row {
  id: string;
  title: string;
  lane: string;
  status: string;
  done: string;
  /** 0-based line index in EPIC.md. */
  lineNo: number;
}

export interface EpicPackage {
  /** Path of EPIC.md. */
  path: string;
  /** The package folder (dirname of `path`). */
  dir: string;
  text: string;
  id: string;
  title: string;
  status: Record<string, string>;
  /** Line indexes of the two status markers. */
  statusSpan: [number, number] | null;
  rows: Row[];
  ledger: Array<{ id: string; date: string }>;
}

export interface Handoff {
  text: string;
  found: boolean;
  epic: string;
  after: string;
  next: string;
  written: string;
}

/** The agent the `next` spawn started (or found) for the next story. */
export type Spawned = { workspaceId: string; agentId: string; title: string };

/** Run `next` for the closed story and start the next story's agent; shared by the RPC and the turn-ended hook. */
export type SpawnNext = (input: {
  root: string;
  story?: string;
  /** Epic or story id naming the package whose last closed story `next` runs for, when `story` is absent. */
  ref?: string;
}) => Promise<NextResult & { spawned: Spawned | null; message: string }>;
