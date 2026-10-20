import { expect, test, vi } from "vitest";

// The client entry imports React Native components, which do not load under
// node; the host supplies them at runtime. Only the registrations are checked.
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));

type Registration = { kind: string; contribution: Record<string, unknown> };

/** A client that records every `add*` call. */
function fakeClient() {
  const added: Registration[] = [];
  const record = (kind: string) => (contribution: Record<string, unknown>) => {
    added.push({ kind, contribution });
    return () => {};
  };
  const client = {
    addWorkspacePanel: record("panel"),
    addSlashCommand: record("slash"),
    addCommandCenterItem: record("command"),
    // The header buttons wait for a workspace list that never comes.
    paseo: { workspaces: { list: () => new Promise(() => {}) } },
  };
  return { client, added };
}

test("the Epic panel is offered in the workspace and in the Explorer", async () => {
  const { default: contribute } = await import("../index.client");
  const { client, added } = fakeClient();
  contribute(client as never);
  const panel = added.find((r) => r.kind === "panel")?.contribution;
  expect(panel?.id).toBe("epic");
  expect(panel?.locations).toEqual(["workspace", "explorer"]);
});
