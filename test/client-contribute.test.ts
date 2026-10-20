import { expect, test, vi } from "vitest";

// The client entry imports React Native components, which do not load under
// node; the host supplies them at runtime. Only the registrations are checked.
vi.mock("react-native", () => ({ Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: "SidebarRow" }));

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
    addScreen: record("screen"),
    addSidebarFooterItem: record("sidebar-footer"),
    // The header buttons wait for a workspace list that never comes.
    paseo: { workspaces: { list: vi.fn(() => new Promise(() => {})) } },
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

test("a sidebar footer item Epics opens the Epics screen", async () => {
  const { default: contribute } = await import("../index.client");
  const { client, added } = fakeClient();
  contribute(client as never);
  const screen = added.find((r) => r.kind === "screen")?.contribution;
  const item = added.find((r) => r.kind === "sidebar-footer")?.contribution;
  expect([screen?.id, screen?.title]).toEqual(["epic-overview", "Epics"]);
  expect([item?.id, item?.title]).toEqual(["epic-overview", "Epics"]);
});

test("the header buttons and the Epics screen share one workspace list subscription", async () => {
  const { default: contribute } = await import("../index.client");
  const { client } = fakeClient();
  const cleanup = contribute(client as never);
  expect(client.paseo.workspaces.list).toHaveBeenCalledTimes(1);
  expect(client.paseo.workspaces.list).toHaveBeenCalledWith({ subscribe: {} });
  cleanup();
});
