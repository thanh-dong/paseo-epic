import { expect, test, vi } from "vitest";
import { watchWorkspaces } from "../client/workspaces";

type Observer = { snapshot: (s: unknown) => void; update: (m: unknown) => void };

function descriptor(id: string) {
  return {
    id,
    workspaceDirectory: `/wt/${id}`,
    projectId: "p1",
    projectDisplayName: "repo",
    projectRootPath: "/repo",
    projectKind: "git",
  };
}

const page = (ids: string[], nextCursor: string | null) => ({
  entries: ids.map(descriptor),
  pageInfo: { hasMore: nextCursor !== null, nextCursor, prevCursor: null },
});

/** A workspace API with one subscription and later pages by cursor; records every list() call. */
function fakeWorkspaces(pages: Record<string, ReturnType<typeof page>> = {}) {
  let observer: Observer | null = null;
  const calls: unknown[] = [];
  const release = vi.fn(async () => {});
  const api = {
    list: async (options: { subscribe?: object; page?: { cursor?: string } }) => {
      calls.push(options);
      if (options.subscribe) {
        return {
          subscription: {
            subscribe: (o: Observer) => {
              observer = o;
              return () => {};
            },
            release,
          },
        };
      }
      return pages[options.page?.cursor ?? ""];
    },
  };
  return { api, calls, release, observer: () => observer as unknown as Observer };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("one subscription serves every listener; a late listener gets the list at once; stop releases it once", async () => {
  const fake = fakeWorkspaces();
  const watcher = watchWorkspaces(fake.api as never);
  const first: string[][] = [];
  const second: string[][] = [];
  watcher.listen((list) => first.push(list.map((w) => w.id)));
  await flush();
  fake.observer().snapshot(page(["a"], null));
  const unlisten = watcher.listen((list) => second.push(list.map((w) => w.id)));
  fake.observer().update({ type: "workspace_update", payload: { kind: "upsert", workspace: descriptor("b") } });
  unlisten();
  fake.observer().update({ type: "workspace_update", payload: { kind: "remove", id: "a" } });
  expect(first).toEqual([["a"], ["a", "b"], ["b"]]);
  expect(second).toEqual([["a"], ["a", "b"]]);
  expect(fake.calls).toHaveLength(1);
  watcher.stop();
  watcher.stop();
  expect(fake.release).toHaveBeenCalledTimes(1);
});

test("the pages after the snapshot's first are read without a subscription; an id an update brought is kept", async () => {
  const fake = fakeWorkspaces({ c2: page(["b", "c"], "c3"), c3: page(["d"], null) });
  const watcher = watchWorkspaces(fake.api as never);
  const changes: Array<[string[], string[]]> = [];
  watcher.listen((list, changed) => changes.push([list.map((w) => w.id), [...changed]]));
  await flush();
  fake.observer().snapshot(page(["a"], "c2"));
  // b arrives by update before its page does: the page does not overwrite it.
  const newer = { ...descriptor("b"), workspaceDirectory: "/wt/b-newer" };
  fake.observer().update({ type: "workspace_update", payload: { kind: "upsert", workspace: newer } });
  await flush();
  await flush();
  expect(fake.calls.slice(1)).toEqual([{ page: { limit: 200, cursor: "c2" } }, { page: { limit: 200, cursor: "c3" } }]);
  expect(changes).toEqual([
    [["a"], ["a"]],
    [["a", "b"], ["b"]],
    [["a", "b", "c"], ["c"]],
    [["a", "b", "c", "d"], ["d"]],
  ]);
  let dirs: string[] = [];
  watcher.listen((list) => (dirs = list.map((w) => w.directory)));
  expect(dirs).toContain("/wt/b-newer");
  watcher.stop();
});

test("a release that rejects does not throw", async () => {
  const fake = fakeWorkspaces();
  fake.release.mockImplementation(async () => {
    throw new Error("gone");
  });
  const watcher = watchWorkspaces(fake.api as never);
  await flush();
  watcher.stop();
  await flush();
  expect(fake.release).toHaveBeenCalledTimes(1);
});
