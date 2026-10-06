import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { checkRpc, isEpicRpc, nextRpc, statusRpc, storyChangesRpc } from "../shared/contracts";
import { PanelHeader } from "./PanelHeader";
import { errorText, onResult, type PanelResult, takeResult } from "./results";
import { type RowState, type StoryId, StoryList } from "./StoryRow";
import { labels } from "./strings";
import { type Styles, useStyles } from "./styles";

interface PanelState extends Omit<PanelResult, "ref"> {
  phase: "loading" | "no-epic" | "ready" | "error";
}

/** The epic or story id status is read for; null reads the default package. */
type EpicRef = string | null;

export function EpicPanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  const styles = useStyles(theme, layout.compact);
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [busy, setBusy] = useState(false);

  const isEpic = useRpc(isEpicRpc);
  const readStatus = useRpc(statusRpc);
  const check = useRpc(checkRpc);
  const next = useRpc(nextRpc);
  const storyChanges = useRpc(storyChangesRpc);
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
    // A reused panel instance never carries a ref across workspaces.
    epicRef.current = null;
    if (!dir) return;
    void load(takeResult(dir));
    return onResult(() => {
      const posted = takeResult(dir);
      if (posted) void load(posted);
    });
  }, [dir, load]);

  const [expanded, setExpanded] = useState<Set<StoryId>>(() => new Set());
  const [rowStates, setRowStates] = useState<Map<StoryId, RowState>>(() => new Map());
  // Each row load takes a fresh number from rowSeqNext; only the row's newest
  // load may land. Clearing rowSeq drops every load still in flight.
  const rowSeq = useRef(new Map<StoryId, number>());
  const rowSeqNext = useRef(0);

  const loadRow = useCallback(
    async (story: StoryId) => {
      if (!dir) return;
      const seq = ++rowSeqNext.current;
      rowSeq.current.set(story, seq);
      const settle = (next: (prev: RowState | undefined) => RowState) => {
        if (rowSeq.current.get(story) === seq) {
          setRowStates((prev) => new Map(prev).set(story, next(prev.get(story))));
        }
      };
      setRowStates((prev) => new Map(prev).set(story, { phase: "loading", data: prev.get(story)?.data }));
      try {
        const data = await storyChanges({ workspaceDir: dir, story });
        settle(() => ({ phase: "ready", data }));
      } catch (err) {
        // A failed Refresh keeps the row's previous data under the error.
        settle((prev) => ({ phase: "error", error: errorText(err), data: prev?.data }));
      }
    },
    [dir, storyChanges],
  );

  // Once per workspace and epic: open the in-progress row, else the Next row.
  // A status reload of the same epic keeps the open rows and their data.
  const status = state.status;
  const expandedFor = useRef("");
  useEffect(() => {
    if (!status) return;
    const key = `${dir}\n${status.epic}`;
    if (key === expandedFor.current) return;
    expandedFor.current = key;
    rowSeq.current.clear();
    setRowStates(new Map());
    const first = status.rows.find((r) => r.status === "in_progress") ?? status.rows.find((r) => r.id === status.next);
    setExpanded(new Set(first ? [first.id] : []));
    if (first) void loadRow(first.id);
  }, [dir, status, loadRow]);

  const toggle = (story: StoryId) => {
    const open = !expanded.has(story);
    setExpanded((prev) => {
      const set = new Set(prev);
      if (open) set.add(story);
      else set.delete(story);
      return set;
    });
    const row = rowStates.get(story);
    if (open && !row?.data && row?.phase !== "loading") void loadRow(story);
  };

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
    press(async () => ({ message: (await next({ workspaceDir: dir ?? "", ref: epicRef.current ?? undefined })).message }));

  if (!dir || state.phase === "loading") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>{labels.loading}</Text>
      </View>
    );
  }

  const problems = state.problems ?? status?.problems;
  const openPr = status?.openPr;
  const openBrowser = navigation?.openBrowser;
  const openPrLink = openPr && openBrowser ? () => openBrowser({ url: openPr.url, workspaceId }) : undefined;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {state.phase === "no-epic" ? <Text style={styles.text}>{labels.noEpic}</Text> : null}
      {status ? (
        <>
          <PanelHeader status={status} styles={styles} />
          <StoryList
            rows={status.rows}
            expanded={expanded}
            rowStates={rowStates}
            onToggle={toggle}
            onRefresh={(story) => void loadRow(story)}
            navigation={navigation}
            workspaceId={workspaceId}
            compact={layout.compact}
            styles={styles}
          />
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
