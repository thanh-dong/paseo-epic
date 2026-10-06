import { Text, View } from "react-native";
import type { Styles } from "./styles";
import type { StoryChangesResult } from "./results";
import { labels } from "./strings";

type ChangedFile = NonNullable<StoryChangesResult["changes"]>["files"][number];

/**
 * One line per changed file: the status letter, the path, and an `uncommitted`
 * tag. The path is selectable text and always the full relative path; in
 * compact layout it is cut at the start so the last segments stay visible.
 */
export function FileList({ files, compact, styles }: { files: ChangedFile[]; compact: boolean; styles: Styles }) {
  return (
    <View style={{ gap: 2 }}>
      {files.map((f) => (
        <View key={f.path} style={styles.fileLine}>
          <Text style={styles.letter}>{f.status}</Text>
          <Text
            selectable
            numberOfLines={compact ? 1 : undefined}
            ellipsizeMode={compact ? "head" : undefined}
            style={[styles.text, { flexShrink: 1 }]}
          >
            {f.path}
          </Text>
          {f.committed ? null : <Text style={styles.muted}>{labels.uncommitted}</Text>}
        </View>
      ))}
    </View>
  );
}
