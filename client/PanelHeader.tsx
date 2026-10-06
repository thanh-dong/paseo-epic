import { Text, View } from "react-native";
import type { Status } from "./results";
import type { Styles } from "./styles";

/** The epic's title, branch and counts above the story table. */
export function PanelHeader({ status, styles }: { status: Status; styles: Styles }) {
  return (
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
    </>
  );
}
