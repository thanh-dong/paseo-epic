import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EpicConfig } from "./config";
import { DEFAULT_EPIC_TEMPLATE, DEFAULT_HANDOFF_TEMPLATE } from "./default-templates";

const DEFAULTS = { "epic.md": DEFAULT_EPIC_TEMPLATE, "handoff.md": DEFAULT_HANDOFF_TEMPLATE } as const;

/** The project's override from `config.templates` when it exists, else the shipped default. */
export function templateText(root: string, config: EpicConfig, name: "epic.md" | "handoff.md"): string {
  if (config.templates) {
    const override = join(root, config.templates, name);
    if (existsSync(override)) return readFileSync(override, "utf8");
  }
  return DEFAULTS[name];
}
