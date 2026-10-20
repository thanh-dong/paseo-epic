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

export interface Row {
  /** The first word of the row's first cell, any shape. */
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
  /** The package folder name before its first `-`. */
  id: string;
  title: string;
  /** The Status block lines as `key: value`, for display only. */
  status: Record<string, string>;
  rows: Row[];
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
