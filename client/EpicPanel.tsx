import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { checkRpc, isEpicRpc, nextRpc, statusRpc } from "../shared/contracts";
import { errorText, onResult, type PanelResult, type Status, takeResult } from "./results";
import { labels } from "./strings";

interface PanelState extends Omit<PanelResult, "ref"> {
  phase: "loading" | "no-epic" | "ready" | "error";
}

/** The epic or story id status is read for; null reads the default package. */
type EpicRef = string | null;

const COLUMN_WIDTHS = { story: 220, lane: 90, status: 110 } as const;

function useStyles(theme: PluginWorkspacePanelProps["theme"], compact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: compact ? 12 : 20, gap: compact ? 10 : 14 },
      line: { flexDirection: "row" as const, flexWrap: "wrap" as const, columnGap: 16, rowGap: 4 },
      title: { color: theme.colors.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" as const },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      row: { flexDirection: "row" as const, gap: 8 },
      stackedRow: { gap: 2 },
      actions: {
        flexDirection: compact ? ("column" as const) : ("row" as const),
        alignItems: compact ? ("stretch" as const) : ("center" as const),
        flexWrap: "wrap" as const,
        gap: 10,
      },
      button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const },
      result: { gap: 4 },
      link: { color: theme.colors.foreground, textDecorationLine: "underline" as const },
    }),
    [theme, compact],
  );
}

export function EpicPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  const styles = useStyles(theme, layout.compact);
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);

  const isEpic = useRpc(isEpicRpc);
  const readStatus = useRpc(statusRpc);
  const check = useRpc(checkRpc);
  const next = useRpc(nextRpc);
  const epicRef = useRef<EpicRef>(null);
  // Loads can overlap (a command result while a button's load runs); only the
  // newest one may set the state.
  const loadSeq = useRef(0);

  /** Show `result` beside the status it carries, or a fresh isEpic + status read. */
  const load = useCallback(
    async (result: PanelResult = {}) => {
      if (!dir) return;
      const { ref, status: carried, ...shown } = result;
      if (ref !== undefined) epicRef.current = ref;
      const seq = ++loadSeq.current;
      const settle = (s: PanelState) => {
        if (seq === loadSeq.current) setState(s);
      };
      if (carried) {
        settle({ phase: "ready", status: carried, ...shown });
        return;
      }
      const statusRef = epicRef.current ?? undefined;
      try {
        const { epic } = await isEpic({ workspaceDir: dir });
        if (!epic) {
          settle({ phase: "no-epic", ...shown });
          return;
        }
        settle({ phase: "ready", status: await readStatus({ workspaceDir: dir, ref: statusRef }), ...shown });
      } catch (err) {
        const error = [...new Set([shown.error, errorText(err)].filter(Boolean))].join("\n\n");
        settle({ phase: "error", ...shown, error });
      }
    },
    [dir, isEpic, readStatus],
  );

  useEffect(() => {
    if (!dir) return;
    void load(takeResult(dir));
    return onResult(() => {
      const posted = takeResult(dir);
      if (posted) void load(posted);
    });
  }, [dir, load]);

  const press = useCallback(
    async (action: () => Promise<PanelResult>) => {
      setBusy(true);
      let result: PanelResult;
      try {
        result = await action();
      } catch (err) {
        result = { error: errorText(err) };
      }
      await load(result);
      setBusy(false);
    },
    [load],
  );

  const onCheck = () =>
    press(async () => {
      const results = await check({ workspaceDir: dir ?? "", ref: epicRef.current ?? state.status?.epic });
      return { problems: results.flatMap((r) => r.problems) };
    });
  const onNext = () =>
    press(async () => ({ message: (await next({ workspaceDir: dir ?? "" })).message }));

  if (!dir || state.phase === "loading") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>{labels.loading}</Text>
      </View>
    );
  }

  const { status } = state;
  const problems = state.problems ?? status?.problems;
  const openPr = status?.openPr;
  const openBrowser = navigation?.openBrowser;
  const openPrLink = openPr && openBrowser ? () => openBrowser({ url: openPr.url, workspaceId }) : undefined;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {state.phase === "no-epic" ? <Text style={styles.text}>{labels.noEpic}</Text> : null}
      {status ? (
        <>
          <View style={styles.line}>
            <Text style={styles.title}>{`${status.epic} — ${status.title}`}</Text>
            <Text style={styles.muted}>{`branch ${status.epicBranch}`}</Text>
            {status.behind === null ? null : <Text style={styles.muted}>{`${status.behind} behind base`}</Text>}
          </View>
          <View style={styles.line}>
            <Text style={styles.text}>{`State ${status.state}`}</Text>
            <Text style={styles.text}>{`Stories ${status.stories}`}</Text>
            <Text style={styles.text}>{`Next ${status.next}`}</Text>
          </View>
          <StoryTable rows={status.rows} compact={layout.compact} styles={styles} />
        </>
      ) : null}
      {state.phase === "no-epic" ? null : (
        <View style={styles.actions}>
          {openPr ? (
            <View style={styles.line}>
              <Text style={styles.text}>{`Open PR: #${openPr.number} (${labels.waitingForMerge})`}</Text>
              <Text
                selectable
                accessibilityRole={openPrLink ? "link" : undefined}
                onPress={openPrLink}
                style={openPrLink ? styles.link : styles.muted}
              >
                {openPr.url}
              </Text>
            </View>
          ) : null}
          <ActionButton label={labels.check} busy={busy} onPress={onCheck} styles={styles} />
          <ActionButton label={labels.startNext} busy={busy} onPress={onNext} styles={styles} />
        </View>
      )}
      <View style={styles.result}>
        {busy ? <Text style={styles.muted}>{labels.working}</Text> : null}
        {state.error ? (
          <Text selectable style={styles.text}>
            {state.error}
          </Text>
        ) : null}
        {state.message ? (
          <Text selectable style={styles.text}>
            {state.message}
          </Text>
        ) : null}
        {problems && problems.length === 0 ? <Text style={styles.muted}>{labels.lastCheckOk}</Text> : null}
        {problems && problems.length > 0 ? (
          <>
            <Text style={styles.text}>{`${labels.lastCheckProblems} (${problems.length})`}</Text>
            {problems.map((p, i) => (
              <Text selectable key={`${i}-${p}`} style={styles.muted}>{`- ${p}`}</Text>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

type UseStyles = typeof useStyles;
type Styles = ReturnType<UseStyles>;

function ActionButton(props: { label: string; busy: boolean; onPress: () => void; styles: Styles }) {
  const { label, busy, onPress, styles } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[styles.button, busy ? { opacity: 0.6 } : null]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function StoryTable({ rows, compact, styles }: { rows: Status["rows"]; compact: boolean; styles: Styles }) {
  if (rows.length === 0) return <Text style={styles.muted}>{labels.noStories}</Text>;
  if (compact) {
    // Narrow screens: one block per story, the lane, status and date on a second line.
    return (
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <View key={r.id} style={styles.stackedRow}>
            <Text style={styles.text}>{`${r.id} ${r.title}`}</Text>
            <Text style={styles.muted}>{[r.lane, r.status, r.done].filter(Boolean).join(" · ")}</Text>
          </View>
        ))}
      </View>
    );
  }
  const c = labels.columns;
  return (
    <View style={{ gap: 4 }}>
      <TableRow cells={[c.story, c.lane, c.status, c.done]} textStyle={styles.muted} styles={styles} />
      {rows.map((r) => (
        <TableRow key={r.id} cells={[`${r.id} ${r.title}`, r.lane, r.status, r.done]} textStyle={styles.text} styles={styles} />
      ))}
    </View>
  );
}

function TableRow(props: { cells: [string, string, string, string]; textStyle: { color: string }; styles: Styles }) {
  const { cells, textStyle, styles } = props;
  const [story, lane, status, done] = cells;
  return (
    <View style={styles.row}>
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
    </View>
  );
}
