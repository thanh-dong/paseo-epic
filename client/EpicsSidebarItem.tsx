import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { OVERVIEW_ID, overviewLabels } from "./strings";

/** The sidebar footer row "Epics": opens the Epics screen, active while it is open. */
export function EpicsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ListOrdered"
      label={overviewLabels.title}
      active={currentScreen?.screenId === OVERVIEW_ID}
      onPress={() => openScreen({ screenId: OVERVIEW_ID })}
    />
  );
}
