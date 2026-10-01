import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpicConfig } from "./config";

const DEFAULT_TEMPLATES = fileURLToPath(new URL("../../templates/", import.meta.url));

/** The project's override from `config.templates` when it exists, else the shipped default. */
export function templateText(root: string, config: EpicConfig, name: "epic.md" | "handoff.md"): string {
  if (config.templates) {
    const override = join(root, config.templates, name);
    if (existsSync(override)) return readFileSync(override, "utf8");
  }
  return readFileSync(join(DEFAULT_TEMPLATES, name), "utf8");
}
