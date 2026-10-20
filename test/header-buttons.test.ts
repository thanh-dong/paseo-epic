import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { headerLabel, planButtons, startHeaderButtons } from "../client/header";
import { type WorkspaceInfo, watchWorkspaces } from "../client/workspaces";

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

type Observer = { snapshot: (s: unknown) => void; update: (m: unknown) => void };
type Answer = { epic: string | null; next: string } | null | Error;

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

/**
 * A client with a header RPC that answers per directory (an Error rejects),
 * recorded buttons, and a workspace watcher over a fake one-page subscription.
 */
function fakeClient(answers: Record<string, Answer>) {
  let observer: Observer | null = null;
  const watcher = watchWorkspaces({
    list: async () => ({
      subscription: {
        subscribe: (o: Observer) => {
          observer = o;
          return () => {};
        },
        release: async () => {},
      },
    }),
  } as never);
  const buttons: Array<{ workspaceId: string; label: string; removed: boolean }> = [];
  const rpcCalls: string[] = [];
  const client = {
    rpc: async (_contract: unknown, input: { workspaceDir: string }) => {
      rpcCalls.push(input.workspaceDir);
      const answer = answers[input.workspaceDir] ?? null;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    addHeaderButton: (c: { workspaceId: string; button: { label?: string } }) => {
      const b = { workspaceId: c.workspaceId, label: c.button.label ?? "", removed: false };
      buttons.push(b);
      return {
        update: (patch: { label?: string }) => {
          if (patch.label !== undefined) b.label = patch.label;
        },
        remove: () => void (b.removed = true),
      };
    },
    openPanel: vi.fn(),
    openScreen: vi.fn(),
  };
  const snapshot = (...ids: Array<[string, string]>) =>
    (observer as unknown as Observer).snapshot({
      entries: ids.map(([id, dir]) => descriptor(id, dir)),
      pageInfo: { hasMore: false, nextCursor: null, prevCursor: null },
    });
  const upsert = (id: string, dir: string) =>
    (observer as unknown as Observer).update({
      type: "workspace_update",
      payload: { kind: "upsert", workspace: descriptor(id, dir) },
    });
  const remove = (id: string) =>
    (observer as unknown as Observer).update({ type: "workspace_update", payload: { kind: "remove", id } });
  return { client, watcher, buttons, rpcCalls, snapshot, upsert, remove };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let pending promises and timers up to `ms` run. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

test("startHeaderButtons follows the workspace list and its cleanup removes every button", async () => {
  const answers: Record<string, Answer> = {
    "/a": { epic: "E10", next: "TH-E10-3" },
    "/b": null,
  };
  const fake = fakeClient(answers);
  const stop = startHeaderButtons(fake.client as never, fake.watcher);
  await tick();
  fake.snapshot(["a", "/a"], ["b", "/b"]);
  await tick();
  expect(fake.buttons.map((b) => [b.workspaceId, b.label])).toEqual([["a", "E10 · next TH-E10-3"]]);

  // An update of a re-reads its label after the quiet time; b is asked once only.
  answers["/a"] = { epic: "E10", next: "none" };
  fake.upsert("a", "/a");
  await tick(2000);
  expect(fake.buttons[0].label).toBe("E10 · closed");
  fake.upsert("b", "/b");
  await tick(2000);
  expect(fake.rpcCalls.filter((d) => d === "/b")).toHaveLength(1);

  // A new epic workspace gets a button; one that leaves the list loses it.
  answers["/c"] = { epic: null, next: "" };
  fake.upsert("c", "/c");
  await tick();
  fake.remove("a");
  await tick();
  expect(fake.buttons.map((b) => [b.workspaceId, b.label, b.removed])).toEqual([
    ["a", "E10 · closed", true],
    ["c", "Epic", false],
  ]);

  stop();
  expect(fake.buttons.every((b) => b.removed)).toBe(true);
  fake.watcher.stop();
});

test("five updates of a workspace within a second give one label read, 2 s after the last", async () => {
  const fake = fakeClient({ "/a": { epic: "E10", next: "TH-E10-3" } });
  const stop = startHeaderButtons(fake.client as never, fake.watcher);
  await tick();
  fake.snapshot(["a", "/a"]);
  await tick();
  const before = fake.rpcCalls.length;
  for (let i = 0; i < 5; i++) {
    fake.upsert("a", "/a");
    await tick(200);
  }
  // The last update was at 800 ms; it is now 1000 ms.
  await tick(1700);
  expect(fake.rpcCalls.length).toBe(before);
  await tick(100);
  expect(fake.rpcCalls.length).toBe(before + 1);
  stop();
  fake.watcher.stop();
});

test("a failed answer is not kept: the next update of that workspace asks again and adds the button", async () => {
  const answers: Record<string, Answer> = { "/a": new Error("daemon busy") };
  const fake = fakeClient(answers);
  const stop = startHeaderButtons(fake.client as never, fake.watcher);
  await tick();
  fake.snapshot(["a", "/a"]);
  await tick();
  expect(fake.buttons).toEqual([]);
  answers["/a"] = { epic: "E10", next: "TH-E10-3" };
  fake.upsert("a", "/a");
  await tick();
  expect(fake.rpcCalls).toEqual(["/a", "/a"]);
  expect(fake.buttons.map((b) => [b.workspaceId, b.label])).toEqual([["a", "E10 · next TH-E10-3"]]);
  stop();
  fake.watcher.stop();
});

test("the header menu opens the panel, the Explorer panel and the overview, and starts nothing", async () => {
  const fake = fakeClient({ "/a": { epic: "E10", next: "TH-E10-3" } });
  let menu: Array<{ title: string; behavior: { kind: string; onPress: () => void } }> = [];
  const add = fake.client.addHeaderButton;
  fake.client.addHeaderButton = (c) => {
    menu = (c.button as unknown as { behavior: { items: typeof menu } }).behavior.items;
    return add(c);
  };
  const stop = startHeaderButtons(fake.client as never, fake.watcher);
  await tick();
  fake.snapshot(["a", "/a"]);
  await tick();
  expect(menu.map((m) => m.title)).toEqual(["Open Epic panel", "Open in Explorer", "Epic overview"]);
  for (const item of menu) item.behavior.onPress();
  expect(fake.client.openPanel.mock.calls).toEqual([
    ["epic", { workspaceId: "a", location: "workspace" }],
    ["epic", { workspaceId: "a", location: "explorer" }],
  ]);
  expect(fake.client.openScreen.mock.calls).toEqual([[{ screenId: "epic-overview" }]]);
  stop();
  fake.watcher.stop();
});
