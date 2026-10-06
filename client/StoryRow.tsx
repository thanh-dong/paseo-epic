import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Styles } from "./styles";
import { FileList } from "./FileList";
import type { Status, StoryChangesResult } from "./results";
import { changesVs, labels } from "./strings";

export interface RowState {
  phase: "idle" | "loading" | "ready" | "error";
  data?: StoryChangesResult;
  error?: string;
}

type Row = Status["rows"][number];
/** A story id. Named so no lowercase type sits in angle brackets (the mobile audit greps for HTML tags). */
export type StoryId = string;
type Navigation = PluginWorkspacePanelProps["navigation"];

interface RowProps {
  expanded: boolean;
  state: RowState | undefined;
  onToggle: () => void;
  onRefresh: () => void;
  navigation: Navigation;
  /** The panel's workspace; the browser opens the PR link for it. */
  workspaceId: string;
  compact: boolean;
  styles: Styles;
}

const COLUMN_WIDTHS = { story: 220, lane: 90, status: 110 } as const;

/** The chevron and the dot take this width; the column headings indent by it. */
const MARKER_WIDTH = 30;

/** The story table: column headings (wide layout only), then one row per story. */
export function StoryList(
  props: Omit<RowProps, "expanded" | "state" | "onToggle" | "onRefresh"> & {
    rows: Status["rows"];
    expanded: Set<StoryId>;
    rowStates: Map<StoryId, RowState>;
    onToggle: (story: string) => void;
    onRefresh: (story: string) => void;
  },
) {
  const { rows, expanded, rowStates, onToggle, onRefresh, ...shared } = props;
  const { styles, compact } = shared;
  if (rows.length === 0) return <Text style={styles.muted}>{labels.noStories}</Text>;
  const c = labels.columns;
  return (
    <View style={{ gap: compact ? 8 : 4 }}>
      {compact ? null : (
        <View style={[styles.row, { paddingLeft: MARKER_WIDTH }]}>
          <Cells cells={[c.story, c.lane, c.status, c.done]} textStyle={styles.muted} />
        </View>
      )}
      {rows.map((r) => (
        <StoryRow
          key={r.id}
          row={r}
          expanded={expanded.has(r.id)}
          state={rowStates.get(r.id)}
          onToggle={() => onToggle(r.id)}
          onRefresh={() => onRefresh(r.id)}
          {...shared}
        />
      ))}
    </View>
  );
}

export function StoryRow(props: RowProps & { row: Row }) {
  const { row, expanded, onToggle, compact, styles } = props;
  const dotColor =
    row.status === "in_progress"
      ? styles.dotColors.active
      : row.status === "implemented"
        ? styles.dotColors.done
        : styles.dotColors.other;
  const markers = (
    <>
      <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
    </>
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.id} ${row.title}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={compact ? styles.stackedRow : styles.rowHeader}
      >
        {compact ? (
          <>
            <View style={styles.rowHeader}>
              {markers}
              <Text style={[styles.text, { flexShrink: 1 }]}>{`${row.id} ${row.title}`}</Text>
            </View>
            <Text style={[styles.muted, { paddingLeft: MARKER_WIDTH }]}>
              {[row.lane, row.status, row.done].filter(Boolean).join(" · ")}
            </Text>
          </>
        ) : (
          <>
            {markers}
            <Cells cells={[`${row.id} ${row.title}`, row.lane, row.status, row.done]} textStyle={styles.text} />
          </>
        )}
      </Pressable>
      {expanded ? <RowDetails {...props} /> : null}
    </View>
  );
}

function Cells({ cells, textStyle }: { cells: [string, string, string, string]; textStyle: { color: string } }) {
  const [story, lane, status, done] = cells;
  return (
    <>
      <Text numberOfLines={1} style={[textStyle, { width: COLUMN_WIDTHS.story }]}>
        {story}
      </Text>
      <Text numberOfLines={1} style={[textStyle, { width: COLUMN_WIDTHS.lane }]}>
        {lane}
      </Text>
      <Text numberOfLines={1} style={[textStyle, { width: COLUMN_WIDTHS.status }]}>
        {status}
      </Text>
      <Text numberOfLines={1} style={[textStyle, { flex: 1 }]}>
        {done}
      </Text>
    </>
  );
}

/** The expanded area: the story's workspace, agent, PR and changed files. */
function RowDetails(props: RowProps & { row: Row }) {
  const { row, state, onRefresh, navigation, workspaceId, compact, styles } = props;
  const data = state?.data;
  const loading = !state || state.phase === "idle" || state.phase === "loading";
  const openBrowser = navigation?.openBrowser;
  const pr = data?.pr;
  const openPr = pr && openBrowser ? () => openBrowser({ url: pr.url, workspaceId }) : undefined;
  const changes = data?.changes;
  const ws = data?.workspace;
  const agent = data?.agent;
  const uncommitted = changes ? changes.files.filter((f) => !f.committed).length : 0;
  return (
    <View style={styles.details}>
      <Pressable accessibilityRole="button" accessibilityLabel={labels.refresh} onPress={onRefresh} style={styles.refresh}>
        <Text style={styles.link}>{labels.refresh}</Text>
      </Pressable>
      {loading ? <Text style={styles.muted}>{labels.loadingRow}</Text> : null}
      {state?.phase === "error" ? (
        <Text selectable style={styles.text}>
          {state.error}
        </Text>
      ) : null}
      {ws ? (
        <DetailLine label={`${labels.workspace} ${ws.name}`} styles={styles}>
          {navigation ? (
            <NavButton
              label={labels.openWorkspace}
              onPress={() => navigation.openWorkspace({ workspaceId: ws.id })}
              styles={styles}
            />
          ) : null}
        </DetailLine>
      ) : null}
      {agent ? (
        <DetailLine label={`${labels.agent} ${agent.title ?? agent.id} (${agent.status})`} styles={styles}>
          {navigation ? (
            <NavButton label={labels.openAgent} onPress={() => navigation.openAgent({ agentId: agent.id })} styles={styles} />
          ) : null}
        </DetailLine>
      ) : null}
      {data ? (
        <View style={styles.line}>
          <Text style={styles.muted}>{labels.pr}</Text>
          {pr ? (
            <Text selectable accessibilityRole={openPr ? "link" : undefined} onPress={openPr} style={openPr ? styles.link : styles.text}>
              {openPr ? `#${pr.number} (${pr.state})` : `#${pr.number} (${pr.state}) ${pr.url}`}
            </Text>
          ) : (
            <Text style={styles.muted}>{data.done || row.done || labels.noPr}</Text>
          )}
        </View>
      ) : null}
      {changes ? (
        <>
          <Text style={styles.text}>{changesVs(changes.base, changes.files.length, uncommitted)}</Text>
          {changes.files.length === 0 ? (
            <Text style={styles.muted}>{labels.noChanges}</Text>
          ) : (
            <FileList files={changes.files} compact={compact} styles={styles} />
          )}
        </>
      ) : null}
      {data?.note ? (
        <Text selectable style={styles.muted}>
          {data.note}
        </Text>
      ) : null}
    </View>
  );
}

function DetailLine({ label, styles, children }: { label: string; styles: Styles; children: ReactNode }) {
  return (
    <View style={[styles.line, { alignItems: "center" }]}>
      <Text style={styles.text}>{label}</Text>
      {children}
    </View>
  );
}

function NavButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: Styles }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.rowButton}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
