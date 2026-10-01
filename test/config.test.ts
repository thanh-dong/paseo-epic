import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadConfig } from "../server/core/config";
import { templateText } from "../server/core/templates";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "paseo-epic-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("defaults when .epic.yml is absent", () => {
  expect(loadConfig(root)).toEqual({
    epicsDir: "docs/stories/epics",
    branchPrefix: "feat/",
    baseBranch: "main",
    hooks: { start: [], close: [] },
  });
});

test("reads hooks and profile", () => {
  writeFileSync(
    join(root, ".epic.yml"),
    "profile: story\nhooks:\n  start:\n    - Run the gate.\n  nextPrompt: Start the next story.\n",
  );
  const cfg = loadConfig(root);
  expect(cfg.profile).toBe("story");
  expect(cfg.hooks.start).toEqual(["Run the gate."]);
  expect(cfg.hooks.close).toEqual([]);
  expect(cfg.hooks.nextPrompt).toBe("Start the next story.");
  expect(cfg.epicsDir).toBe("docs/stories/epics");
});

test("unknown key is one clear error", () => {
  writeFileSync(join(root, ".epic.yml"), "epicDir: x\n");
  expect(() => loadConfig(root)).toThrow(/\.epic\.yml.*epicDir/);
});

test("invalid yaml is one clear error", () => {
  writeFileSync(join(root, ".epic.yml"), "hooks: [\n");
  expect(() => loadConfig(root)).toThrow(/\.epic\.yml/);
});

test("template override wins over the default", () => {
  mkdirSync(join(root, "tpl"));
  writeFileSync(join(root, "tpl", "epic.md"), "# custom\n");
  writeFileSync(join(root, ".epic.yml"), "templates: tpl\n");
  const cfg = loadConfig(root);
  expect(templateText(root, cfg, "epic.md")).toBe("# custom\n");
});

test("default template is the shipped file", () => {
  const defaults = loadConfig(root);
  expect(templateText(root, defaults, "handoff.md")).toContain("<!-- handoff: epic=ENN");
});
