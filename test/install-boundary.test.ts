import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// Paseo compiles the plugin on the host after `npm ci --omit=dev`. Its
// runtime-boundary check skips host-supplied modules; every other import,
// type-only ones included, must resolve from the plugin's own production
// dependencies. Host list copied from Paseo 0.10.2 plugin-sdk-specifiers.js
// and compiler.js.
const HOST_SDK = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
];
const HOST_RUNTIME = /^(zod|react|react-native|@tanstack\/react-query)(\/|$)/;

const ROOT = join(__dirname, "..");
const GENERATED = new Set(["server/mcp/bundle.generated.ts"]);
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;

function sourceFiles(): string[] {
  const out = ["index.client.tsx", "index.server.ts"];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !GENERATED.has(rel)) out.push(rel);
    }
  };
  for (const dir of ["client", "server", "shared"]) walk(dir);
  return out;
}

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

test("every import resolves on a production-only install", () => {
  const deps = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {});
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [, spec] of text.matchAll(IMPORT_RE)) {
      if (spec.startsWith(".") || spec.startsWith("node:") || builtinModules.includes(spec)) continue;
      if (HOST_SDK.includes(spec) || HOST_RUNTIME.test(spec)) continue;
      if (deps.includes(packageName(spec))) continue;
      offenders.push(`${relative(ROOT, join(ROOT, file))}: ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});
