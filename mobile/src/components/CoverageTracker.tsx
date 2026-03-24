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

export default function CoverageTracker({
  coverage,
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
  const remainingCount = Math.max(totalCount - scannedCount, 0);
  const pendingWaypoints = roomWaypoints?.filter((wp) => !wp.scanned) ?? [];
  const capturedWaypoints = roomWaypoints?.filter((wp) => wp.scanned) ?? [];

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
          {remainingCount > 0 ? ` - ${remainingCount} left` : ""}
        </Text>
      )}

      {pendingWaypoints.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Still needed</Text>
          <View style={styles.waypointsRow}>
            {pendingWaypoints.map((wp) => (
              <View key={wp.id} style={styles.waypointItem}>
                <View style={[styles.dot, styles.dotPending]} />
                {wp.label ? (
                  <Text style={styles.dotLabel} numberOfLines={2}>
                    {wp.label}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </>
      )}

      {capturedWaypoints.length > 0 && (
        <View style={styles.capturedSummaryRow}>
          <Text style={styles.capturedSummaryText}>
            Captured {capturedWaypoints.length}
          </Text>
          <View style={styles.capturedDotsRow}>
            {capturedWaypoints.map((wp) => (
              <View key={wp.id} style={[styles.dot, styles.dotScanned]} />
            ))}
          </View>
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
  sectionLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  waypointsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
    paddingTop: 2,
  },
  waypointItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    maxWidth: "48%",
    minWidth: "48%",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 4,
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
  capturedSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 2,
    flexWrap: "wrap",
  },
  capturedSummaryText: {
    color: "rgba(34,197,94,0.7)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  capturedDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    flexShrink: 1,
  },
});
