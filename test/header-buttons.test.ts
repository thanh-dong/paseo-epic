import { expect, test, vi } from "vitest";
import { headerLabel, planButtons, startHeaderButtons } from "../client/header";
import type { WorkspaceInfo } from "../client/workspaces";

function ws(id: string, directory: string): WorkspaceInfo {
  return { id, directory, projectId: "p1", projectName: "repo", projectRoot: "/repo", git: true };
}

test("headerLabel: next story, closed epic, no package yet, no header", () => {
  expect(headerLabel({ epic: "E10", next: "TH-E10-3" })).toBe("E10 · next TH-E10-3");
  expect(headerLabel({ epic: "E10", next: "none" })).toBe("E10 · closed");
  expect(headerLabel({ epic: null, next: "" })).toBe("Epic");
  expect(headerLabel({ epic: "E10", next: "" })).toBe("E10");
});

test("planButtons adds epic workspaces, re-labels changed ones, removes the rest", () => {
  const a = ws("a", "/a");
  const b = ws("b", "/b");
  const c = ws("c", "/c");
  const epic = new Map([
    ["/a", true],
    ["/b", true],
    ["/c", false],
  ]);
  // Nothing yet: every epic workspace gets a button, whatever changed.
  expect(planButtons(new Set(), [a, b, c], epic, new Set(["a"]))).toEqual({ add: [a, b], update: [], remove: [] });
  // An update for a: only a is re-labelled.
  expect(planButtons(new Set(["a", "b"]), [a, b, c], epic, new Set(["a"]))).toEqual({ add: [], update: [a], remove: [] });
  // b left the list, and a directory not asked yet has no button.
  expect(planButtons(new Set(["a", "b"]), [a, ws("d", "/d")], epic, new Set(["b"]))).toEqual({
    add: [],
    update: [],
    remove: ["b"],
  });
});

type Observer = { snapshot: (s: { entries: unknown[] }) => void; update: (m: unknown) => void };

function descriptor(id: string, dir: string) {
  return {
    id,
    workspaceDirectory: dir,
    projectId: "p1",
    projectDisplayName: "repo",
    projectRootPath: "/repo",
    projectKind: "git",
  };
}

/** A client with one workspace subscription, a header RPC that answers per directory, and recorded buttons. */
function fakeClient(answers: Record<string, { epic: string | null; next: string } | null>) {
  let observer: Observer | null = null;
  const release = vi.fn(async () => {});
  const buttons: Array<{ workspaceId: string; label: string; removed: boolean; update: ReturnType<typeof vi.fn> }> = [];
  const rpcCalls: string[] = [];
  const client = {
    paseo: {
      workspaces: {
        list: async () => ({
          subscription: {
            subscribe: (o: Observer) => {
              observer = o;
              return () => {};
            },
            release,
          },
        }),
      },
    },
    rpc: async (_contract: unknown, input: { workspaceDir: string }) => {
      rpcCalls.push(input.workspaceDir);
      return answers[input.workspaceDir] ?? null;
    },
    addHeaderButton: (c: { workspaceId: string; button: { label?: string } }) => {
      const b = {
        workspaceId: c.workspaceId,
        label: c.button.label ?? "",
        removed: false,
        update: vi.fn((patch: { label?: string }) => {
          if (patch.label !== undefined) b.label = patch.label;
        }),
      };
      buttons.push(b);
      return { update: b.update, remove: () => void (b.removed = true) };
    },
    openPanel: vi.fn(),
    openScreen: vi.fn(),
  };
  return { client, buttons, release, rpcCalls, observer: () => observer as unknown as Observer };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("startHeaderButtons follows the workspace list and its cleanup removes every button", async () => {
  const answers: Record<string, { epic: string | null; next: string } | null> = {
    "/a": { epic: "E10", next: "TH-E10-3" },
    "/b": null,
  };
  const fake = fakeClient(answers);
  const stop = startHeaderButtons(fake.client as never);
  await flush();
  fake.observer().snapshot({ entries: [descriptor("a", "/a"), descriptor("b", "/b")] });
  await flush();
  expect(fake.buttons.map((b) => [b.workspaceId, b.label])).toEqual([["a", "E10 · next TH-E10-3"]]);

  // An update of a re-reads its label; b is asked once only.
  answers["/a"] = { epic: "E10", next: "none" };
  fake.observer().update({ type: "workspace_update", payload: { kind: "upsert", workspace: descriptor("a", "/a") } });
  await flush();
  expect(fake.buttons[0].label).toBe("E10 · closed");
  fake.observer().update({ type: "workspace_update", payload: { kind: "upsert", workspace: descriptor("b", "/b") } });
  await flush();
  expect(fake.rpcCalls.filter((d) => d === "/b")).toHaveLength(1);

  // A new epic workspace gets a button; one that leaves the list loses it.
  answers["/c"] = { epic: null, next: "" };
  fake.observer().update({ type: "workspace_update", payload: { kind: "upsert", workspace: descriptor("c", "/c") } });
  await flush();
  fake.observer().update({ type: "workspace_update", payload: { kind: "remove", id: "a" } });
  await flush();
  expect(fake.buttons.map((b) => [b.workspaceId, b.label, b.removed])).toEqual([
    ["a", "E10 · closed", true],
    ["c", "Epic", false],
  ]);

  stop();
  expect(fake.buttons.every((b) => b.removed)).toBe(true);
  expect(fake.release).toHaveBeenCalledTimes(1);
});

test("the header menu opens the panel, the Explorer panel and the overview, and starts nothing", async () => {
  const fake = fakeClient({ "/a": { epic: "E10", next: "TH-E10-3" } });
  let menu: Array<{ title: string; behavior: { kind: string; onPress: () => void } }> = [];
  const add = fake.client.addHeaderButton;
  fake.client.addHeaderButton = (c) => {
    menu = (c.button as unknown as { behavior: { items: typeof menu } }).behavior.items;
    return add(c);
  };
  const stop = startHeaderButtons(fake.client as never);
  await flush();
  fake.observer().snapshot({ entries: [descriptor("a", "/a")] });
  await flush();
  expect(menu.map((m) => m.title)).toEqual(["Open Epic panel", "Open in Explorer", "Epic overview"]);
  for (const item of menu) item.behavior.onPress();
  expect(fake.client.openPanel.mock.calls).toEqual([
    ["epic", { workspaceId: "a", location: "workspace" }],
    ["epic", { workspaceId: "a", location: "explorer" }],
  ]);
  expect(fake.client.openScreen.mock.calls).toEqual([[{ screenId: "epic-overview" }]]);
  stop();
});
