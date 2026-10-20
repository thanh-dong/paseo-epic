import { type PluginScreenProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { overviewRpc } from "../shared/contracts";
import { cardLines, groupProjects, type OverviewEpic, type ProjectGroup, type ProjectState, sections } from "./overview";
import { errorText } from "./results";
import { closedHidden, overviewLabels } from "./strings";
import { type Styles, useStyles } from "./styles";
import { type ProjectId, watchWorkspaces } from "./workspaces";

type Navigation = PluginScreenProps["navigation"];
type OpenPanel = (workspaceId: string) => void;

/**
 * The Epics screen: the epics of every git project on this host, read from
 * the epic branches on origin. `openPanel` opens the Epic panel in a
 * workspace; a screen gets no panel opener of its own.
 */
export function makeEpicOverview(openPanel: OpenPanel) {
  return function EpicOverview({ theme, layout, navigation }: PluginScreenProps) {
    const paseo = usePaseo();
    const readOverview = useRpc(overviewRpc);
    const styles = useStyles(theme, layout.compact);
    const [groups, setGroups] = useState<ProjectGroup[]>([]);
    const [states, setStates] = useState<Map<ProjectId, ProjectState>>(() => new Map());
    const [showClosed, setShowClosed] = useState(false);
    const asked = useRef(new Set<ProjectId>());
    // Reads of one project can overlap (a Refresh during the first read); only the newest may land.
    const seq = useRef(new Map<ProjectId, number>());
    const seqNext = useRef(0);

    useEffect(() => watchWorkspaces(paseo.workspaces, (list) => setGroups(groupProjects(list))), [paseo]);

    const load = useCallback(
      async (group: ProjectGroup, fetch: boolean) => {
        const n = ++seqNext.current;
        seq.current.set(group.projectId, n);
        const settle = (next: (prev: ProjectState | undefined) => ProjectState) => {
          if (seq.current.get(group.projectId) === n) {
            setStates((prev) => new Map(prev).set(group.projectId, next(prev.get(group.projectId))));
          }
        };
        settle((prev) => ({ ...prev, phase: "loading" }));
        try {
          const { epics } = await readOverview({ projectRoot: group.root, workspaces: group.workspaces, fetch });
          settle(() => ({ phase: "ready", epics }));
        } catch (err) {
          // A failed Refresh keeps the project's previous epics under the error.
          settle((prev) => ({ phase: "error", error: errorText(err), epics: prev?.epics }));
        }
      },
      [readOverview],
    );

    // Each project is read once, when it first shows up; Refresh fetches and reads them all again.
    useEffect(() => {
      for (const g of groups) {
        if (asked.current.has(g.projectId)) continue;
        asked.current.add(g.projectId);
        void load(g, false);
      }
    }, [groups, load]);

    const reading = [...states.values()].some((s) => s.phase === "loading");
    const shown = sections(groups, states, showClosed);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={overviewLabels.refresh}
            accessibilityState={{ disabled: reading }}
            disabled={reading}
            onPress={() => {
              for (const g of groups) void load(g, true);
            }}
            style={[styles.button, reading ? { opacity: 0.6 } : null]}
          >
            <Text style={styles.buttonText}>{overviewLabels.refresh}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={overviewLabels.showClosed}
            accessibilityState={{ checked: showClosed }}
            onPress={() => setShowClosed((on) => !on)}
            style={showClosed ? styles.button : styles.toggleOff}
          >
            <Text style={showClosed ? styles.buttonText : styles.text}>{overviewLabels.showClosed}</Text>
          </Pressable>
        </View>
        {reading ? <Text style={styles.muted}>{overviewLabels.reading}</Text> : null}
        {!reading && shown.length === 0 ? <Text style={styles.muted}>{overviewLabels.none}</Text> : null}
        {shown.map((section) => (
          <View key={section.projectId} style={styles.section}>
            <Text style={styles.title}>{section.name}</Text>
            {section.error === null ? null : (
              <Text selectable style={styles.text}>
                {section.error}
              </Text>
            )}
            {section.epics.map((epic) => (
              <EpicCard
                key={epic.branch}
                epic={epic}
                navigation={navigation}
                openPanel={openPanel}
                styles={styles}
              />
            ))}
            {section.hidden > 0 ? <Text style={styles.muted}>{closedHidden(section.hidden)}</Text> : null}
          </View>
        ))}
      </ScrollView>
    );
  };
}

function EpicCard(props: { epic: OverviewEpic; navigation: Navigation; openPanel: OpenPanel; styles: Styles }) {
  const { epic, navigation, openPanel, styles } = props;
  const lines = cardLines(epic);
  const { openPr, workspaceId } = epic;
  const openBrowser = navigation?.openBrowser;
  const openPrLink = openPr && openBrowser && workspaceId ? () => openBrowser({ url: openPr.url, workspaceId }) : undefined;
  const openWorkspace = navigation?.openWorkspace;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{lines.heading}</Text>
      {lines.status ? <Text style={styles.muted}>{lines.status}</Text> : null}
      <Text style={styles.text}>{lines.stories}</Text>
      {openPr ? (
        <View style={styles.line}>
          <Text style={styles.text}>{`PR #${openPr.number}`}</Text>
          <Text
            selectable
            accessibilityRole={openPrLink ? "link" : undefined}
            onPress={openPrLink}
            style={openPrLink ? styles.link : styles.muted}
          >
            {openPr.url}
          </Text>
        </View>
      ) : (
        <Text style={styles.muted}>{overviewLabels.noPr}</Text>
      )}
      {workspaceId ? (
        <View style={styles.row}>
          {openWorkspace ? (
            <CardButton label={overviewLabels.openWorkspace} onPress={() => openWorkspace({ workspaceId })} styles={styles} />
          ) : null}
          <CardButton label={overviewLabels.openPanel} onPress={() => openPanel(workspaceId)} styles={styles} />
        </View>
      ) : null}
    </View>
  );
}

function CardButton(props: { label: string; onPress: () => void; styles: Styles }) {
  const { label, onPress, styles } = props;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.rowButton}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
