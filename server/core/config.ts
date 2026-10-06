import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { EpicError } from "./types";

export interface EpicConfig {
  epicsDir: string;
  templates?: string;
  branchPrefix: string;
  baseBranch: string;
  profile?: string;
  hooks: { start: string[]; close: string[]; nextPrompt?: string };
}

const CONFIG_FILE = ".epic.yml";

const hooksSchema = z
  .object({
    start: z.array(z.string()).default([]),
    close: z.array(z.string()).default([]),
    nextPrompt: z.string().optional(),
  })
  .strict();

const configSchema = z
  .object({
    epicsDir: z.string().default("docs/stories/epics"),
    templates: z.string().optional(),
    branchPrefix: z.string().default("feat/"),
    baseBranch: z.string().default("main"),
    profile: z.string().optional(),
    hooks: hooksSchema.default({ start: [], close: [] }),
  })
  .strict();

/** True when `<root>/.epic.yml` exists, valid or not. */
export function hasConfigFile(root: string): boolean {
  return existsSync(join(root, CONFIG_FILE));
}

/** Read `<root>/.epic.yml` when present and merge it over the defaults. */
export function loadConfig(root: string): EpicConfig {
  const file = join(root, CONFIG_FILE);
  let raw: unknown = {};
  if (existsSync(file)) {
    try {
      raw = parse(readFileSync(file, "utf8")) ?? {};
    } catch (err) {
      throw new EpicError(`${CONFIG_FILE}: ${(err as Error).message}`);
    }
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const keys = issue.code === "unrecognized_keys" ? issue.keys : [];
    const where = [...issue.path, ...keys].map(String).join(".") || "(root)";
    throw new EpicError(`${CONFIG_FILE}: ${where}: ${issue.message}`);
  }
  return result.data;
}
