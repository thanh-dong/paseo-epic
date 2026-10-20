import { expect, test } from "vitest";
import { headerRpc, overviewRpc } from "../shared/contracts";

// A value the core returns must come out of the contract unchanged, on both sides.
function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

test("headerRpc carries the epic and next, no epic yet, and no epic repo", () => {
  expect(roundTrip(headerRpc.input, { workspaceDir: "/repo" })).toEqual({ workspaceDir: "/repo" });
  for (const out of [{ epic: "E10", next: "TH-E10-3" }, { epic: null, next: "" }, null]) {
    expect(roundTrip(headerRpc.output, out)).toEqual(out);
  }
});

test("overviewRpc carries the project's epics, with and without a PR and a workspace", () => {
  const input = { projectRoot: "/repo", workspaces: [{ id: "ws1", directory: "/repo" }], fetch: true };
  expect(roundTrip(overviewRpc.input, input)).toEqual(input);
  const epic = {
    epic: "E10",
    title: "Identity and reach",
    branch: "epic/E10-identity-and-reach",
    state: "in_progress",
    next: "TH-E10-3",
    after: "TH-E10-2",
    rows: { total: 7, open: 5 },
    openPr: { number: 112, url: "https://github.com/o/r/pull/112", headRefName: "feat/TH-E10-2-x" },
    workspaceId: "ws1",
  };
  const out = { project: "/repo", epics: [epic, { ...epic, epic: "E9", openPr: null, workspaceId: null }] };
  expect(roundTrip(overviewRpc.output, out)).toEqual(out);
});
