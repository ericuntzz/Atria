import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface RoomWaypoint {
  id: string;
  label: string | null;
  scanned: boolean;
}

interface Props {
  coverage: number; // 0-100 overall
  currentRoomName?: string;
  roomWaypoints?: RoomWaypoint[];
  roomScannedCount?: number;
  roomTotalCount?: number;
}

/**
 * Strip the room name prefix from a waypoint label so only the distinguishing
 * part is shown. "Home Office/Exercise Room view 3" → "view 3".
 * If the label doesn't start with the room name, return it as-is.
 */
function shortenWaypointLabel(label: string, roomName?: string): string {
  if (!roomName) return label;
  // Try exact prefix match with common separators
  for (const sep of [" - ", ": ", " – ", " "]) {
    const prefix = roomName + sep;
    if (label.startsWith(prefix)) {
      const short = label.slice(prefix.length).trim();
      if (short.length > 0) return short;
    }
  }
  // Try just removing the room name if it's a prefix
  if (label.startsWith(roomName)) {
    const short = label.slice(roomName.length).trim();
    if (short.length > 0) return short;
  }
  return label;
}

export default function CoverageTracker({
  coverage,
  currentRoomName,
  roomWaypoints,
  roomScannedCount,
  roomTotalCount,
}: Props) {
  const clampedCoverage = Math.min(100, Math.max(0, coverage));
  const barColor =
    clampedCoverage >= 90
      ? "#22c55e"
      : clampedCoverage >= 50
        ? "#4DA6FF"
        : "#94a3b8";

  const scannedCount =
    typeof roomScannedCount === "number"
      ? roomScannedCount
      : roomWaypoints?.filter((w) => w.scanned).length ?? 0;
  const totalCount =
    typeof roomTotalCount === "number"
      ? roomTotalCount
      : roomWaypoints?.length ?? 0;
  const roomCoverage =
    totalCount > 0 ? Math.round((scannedCount / totalCount) * 100) : null;

  return (
    <View style={styles.container}>
      {/* Overall progress bar */}
      <View style={styles.barRow}>
        <View style={styles.barBackground}>
          <View
            style={[
              styles.barFill,
              {
                width: `${clampedCoverage}%`,
                backgroundColor: barColor,
              },
            ]}
          />
        </View>
        <Text style={[styles.percentText, { color: barColor }]}>
          Overall {Math.round(clampedCoverage)}%
        </Text>
      </View>

      {totalCount > 0 && (
        <Text style={styles.roomProgressText} numberOfLines={2}>
          {scannedCount}/{totalCount} angles
          {roomCoverage !== null ? ` (${roomCoverage}%)` : ""}
        </Text>
      )}

      {/* Waypoint dots — uncaptured first so user sees what's remaining */}
      {roomWaypoints && roomWaypoints.length > 0 && (
        <View style={styles.waypointsRow}>
          {[...roomWaypoints]
            .sort((a, b) => {
              // Uncaptured first, then captured
              if (a.scanned !== b.scanned) return a.scanned ? 1 : -1;
              return 0;
            })
            .map((wp) => {
              const shortLabel = wp.label
                ? shortenWaypointLabel(wp.label, currentRoomName)
                : null;
              return (
                <View key={wp.id} style={styles.waypointItem}>
                  <View
                    style={[
                      styles.dot,
                      wp.scanned ? styles.dotScanned : styles.dotPending,
                    ]}
                  />
                  {shortLabel && (
                    <Text
                      style={[
                        styles.dotLabel,
                        wp.scanned && styles.dotLabelScanned,
                      ]}
                      numberOfLines={1}
                    >
                      {shortLabel}
                    </Text>
                  )}
                </View>
              );
            })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  barBackground: {
    flex: 1,
    height: 5,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  percentText: {
    fontSize: 12,
    fontWeight: "600",
    minWidth: 0,
    textAlign: "left",
  },
  roomProgressText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  waypointsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    paddingTop: 2,
  },
  waypointItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "48%",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotScanned: {
    backgroundColor: "#22c55e",
  },
  dotPending: {
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
  },
  dotLabelScanned: {
    color: "rgba(34,197,94,0.7)",
  },
});
