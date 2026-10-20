import { expect, test } from "vitest";
import { headerRpc } from "../shared/contracts";

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
