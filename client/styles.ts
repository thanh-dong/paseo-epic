import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";

// The Epic panel's styles, shared by EpicPanel, StoryRow and FileList. Every
// color comes from the host theme.

/** A story row's chevron (14), gap (8), dot (8) and gap (8); headings, the compact second line and details indent by it. */
export const MARKER_WIDTH = 38;

export function useStyles(theme: PluginWorkspacePanelProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 12 : 20, gap: compact ? 10 : 14 },
      line: { flexDirection: "row" as const, flexWrap: "wrap" as const, columnGap: 16, rowGap: 4 },
      title: { color: theme.colors.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" as const },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      row: { flexDirection: "row" as const, gap: 8 },
      rowHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      stackedRow: { gap: 2 },
      chevron: { color: theme.colors.foregroundMuted, width: 14 },
      dot: { width: 8, height: 8, borderRadius: 4 },
      dotColors: { active: theme.colors.accent, done: theme.colors.foreground, other: theme.colors.foregroundMuted },
      details: { paddingLeft: MARKER_WIDTH, paddingVertical: 6, gap: 6 },
      refresh: { alignSelf: "flex-end" as const },
      fileLine: { flexDirection: "row" as const, gap: 8 },
      letter: { color: theme.colors.foregroundMuted, width: 14 },
      actions: {
        flexDirection: compact ? ("column" as const) : ("row" as const),
        alignItems: compact ? ("stretch" as const) : ("center" as const),
        flexWrap: "wrap" as const,
        gap: 10,
      },
      button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.accent },
      rowButton: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
      result: { gap: 4 },
      link: { color: theme.colors.foreground, textDecorationLine: "underline" as const },
    }),
    [theme, compact],
  );
}

type UseStyles = typeof useStyles;
export type Styles = ReturnType<UseStyles>;
