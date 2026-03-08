/**
 * InspectionSummary.tsx — Post-Inspection Report
 *
 * Shows the results of a completed inspection:
 * - Overall readiness score
 * - Completion tier + coverage
 * - Duration
 * - Room-by-room scores + findings
 * - Confirmed findings grouped by severity
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, SummaryData } from "../navigation";
import { colors, radius, shadows } from '../lib/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, "InspectionSummary">;
type Route = RouteProp<RootStackParamList, "InspectionSummary">;

const SEVERITY_COLORS: Record<string, string> = {
  cosmetic: "#64748b",
  maintenance: "#eab308",
  safety: "#4DA6FF",
  urgent_repair: "#ef4444",
  guest_damage: "#a855f7",
};

const SEVERITY_LABELS: Record<string, string> = {
  cosmetic: "Cosmetic",
  maintenance: "Maintenance",
  safety: "Safety",
  urgent_repair: "Urgent Repair",
  guest_damage: "Guest Damage",
};

const MODE_LABELS: Record<string, string> = {
  turnover: "Turnover",
  maintenance: "Maintenance",
  owner_arrival: "Owner Arrival",
  vacancy_check: "Vacancy Check",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getScoreColor(score: number | null): string {
  if (score === null) return colors.muted;
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "#eab308";
  if (score >= 50) return colors.primary;
  return "#ef4444";
}

function getTierLabel(tier: string): string {
  switch (tier) {
    case "thorough":
      return "Thorough";
    case "standard":
      return "Standard";
    case "minimum":
      return "Minimum";
    default:
      return tier;
  }
}

function getTierColor(tier: string): string {
  switch (tier) {
    case "thorough":
      return "#22c55e";
    case "standard":
      return colors.primary;
    default:
      return "#94a3b8";
  }
}

export default function InspectionSummaryScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { summaryData } = route.params;

  const hasData = !!summaryData;
  const data: SummaryData = summaryData || {
    overallScore: null,
    completionTier: "minimum",
    overallCoverage: 0,
    durationMs: 0,
    inspectionMode: "turnover",
    rooms: [],
    confirmedFindings: [],
  };

  // Group confirmed findings by severity
  const findingsBySeverity = useMemo(() => {
    const groups: Record<string, typeof data.confirmedFindings> = {};
    for (const f of data.confirmedFindings) {
      if (!groups[f.severity]) groups[f.severity] = [];
      groups[f.severity].push(f);
    }
    // Sort by severity priority
    const order = ["urgent_repair", "safety", "guest_damage", "maintenance", "cosmetic"];
    const sorted: Array<[string, typeof data.confirmedFindings]> = [];
    for (const sev of order) {
      if (groups[sev]) sorted.push([sev, groups[sev]]);
    }
    return sorted;
  }, [data.confirmedFindings]);

  const scoreDisplay = data.overallScore !== null
    ? Math.round(data.overallScore)
    : "--";

  const scoreColor = getScoreColor(data.overallScore);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Text style={styles.title}>Inspection Complete</Text>
        <View style={styles.headerRow}>
          <View style={styles.modeBadge}>
            <Text style={styles.modeText}>
              {MODE_LABELS[data.inspectionMode] || data.inspectionMode}
            </Text>
          </View>
          {hasData && (
            <Text style={styles.durationText}>
              {formatDuration(data.durationMs)}
            </Text>
          )}
        </View>

        {/* Score Card */}
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>READINESS SCORE</Text>
          <Text style={[styles.scoreValue, { color: scoreColor }]}>
            {scoreDisplay}
          </Text>
          <Text style={styles.scoreSubtext}>
            {data.overallScore !== null
              ? data.overallScore >= 90
                ? "Excellent condition"
                : data.overallScore >= 70
                  ? "Good with minor issues"
                  : data.overallScore >= 50
                    ? "Needs attention"
                    : "Significant issues found"
              : "No comparisons run"}
          </Text>
          {/* Score bar */}
          {data.overallScore !== null && (
            <View style={styles.scoreBarContainer}>
              <View style={styles.scoreBar}>
                <View
                  style={[
                    styles.scoreBarFill,
                    {
                      width: `${Math.min(100, data.overallScore)}%`,
                      backgroundColor: scoreColor,
                    },
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        {/* Coverage Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Coverage</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statItemLabel}>Completion</Text>
              <Text
                style={[
                  styles.statItemValue,
                  { color: getTierColor(data.completionTier) },
                ]}
              >
                {getTierLabel(data.completionTier)}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statItemLabel}>Rooms</Text>
              <Text style={styles.statItemValue}>{data.rooms.length}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statItemLabel}>Coverage</Text>
              <Text style={styles.statItemValue}>{data.overallCoverage}%</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statItemLabel}>Findings</Text>
              <Text
                style={[
                  styles.statItemValue,
                  data.confirmedFindings.length > 0 && { color: colors.primary },
                ]}
              >
                {data.confirmedFindings.length}
              </Text>
            </View>
          </View>
        </View>

        {/* Room-by-Room Breakdown */}
        {data.rooms.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Room Details</Text>
            {data.rooms.map((room) => (
              <View key={room.roomId} style={styles.roomCard}>
                <View style={styles.roomHeader}>
                  <Text style={styles.roomName}>{room.roomName}</Text>
                  {room.score !== null && (
                    <View
                      style={[
                        styles.roomScoreBadge,
                        {
                          backgroundColor: `${getScoreColor(room.score)}18`,
                          borderColor: `${getScoreColor(room.score)}40`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roomScore,
                          { color: getScoreColor(room.score) },
                        ]}
                      >
                        {Math.round(room.score)}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.roomStats}>
                  <Text style={styles.roomStat}>
                    {room.anglesScanned}/{room.anglesTotal} angles
                  </Text>
                  <Text style={styles.roomStatDivider}>|</Text>
                  <Text style={styles.roomStat}>{room.coverage}%</Text>
                  {room.confirmedFindings > 0 && (
                    <>
                      <Text style={styles.roomStatDivider}>|</Text>
                      <Text style={[styles.roomStat, styles.roomFindingsStat]}>
                        {room.confirmedFindings} finding
                        {room.confirmedFindings !== 1 ? "s" : ""}
                      </Text>
                    </>
                  )}
                </View>
                {/* Room coverage bar */}
                <View style={styles.roomCoverageBar}>
                  <View
                    style={[
                      styles.roomCoverageFill,
                      {
                        width: `${room.coverage}%`,
                        backgroundColor:
                          room.coverage >= 90
                            ? "#22c55e"
                            : room.coverage >= 50
                              ? colors.primary
                              : "#94a3b8",
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Confirmed Findings by Severity */}
        {findingsBySeverity.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Findings</Text>
            {findingsBySeverity.map(([severity, findings]) => (
              <View key={severity} style={styles.severityGroup}>
                <View style={styles.severityHeader}>
                  <View
                    style={[
                      styles.severityDot,
                      { backgroundColor: SEVERITY_COLORS[severity] || "#64748b" },
                    ]}
                  />
                  <Text style={styles.severityLabel}>
                    {SEVERITY_LABELS[severity] || severity}
                  </Text>
                  <View style={styles.severityCountBadge}>
                    <Text style={styles.severityCount}>{findings.length}</Text>
                  </View>
                </View>
                {findings.map((finding) => (
                  <View key={finding.id} style={styles.findingRow}>
                    <View
                      style={[
                        styles.findingAccent,
                        { backgroundColor: SEVERITY_COLORS[severity] || "#64748b" },
                      ]}
                    />
                    <View style={styles.findingContent}>
                      <Text style={styles.findingDescription}>
                        {finding.description}
                      </Text>
                      <Text style={styles.findingRoom}>{finding.roomName}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Findings</Text>
            <View style={styles.emptyFindings}>
              <Text style={styles.emptyIcon}>--</Text>
              <Text style={styles.emptyText}>
                {hasData ? "No findings confirmed" : "No findings recorded"}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.completeButton}
          onPress={() => navigation.popToTop()}
          activeOpacity={0.8}
        >
          <Text style={styles.completeButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingTop: 32,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  modeBadge: {
    backgroundColor: "rgba(77, 166, 255, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(77, 166, 255, 0.15)",
  },
  modeText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  durationText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "500",
  },

  // Score
  scoreCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.stone,
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 8,
  },
  scoreValue: {
    fontSize: 56,
    fontWeight: "600",
  },
  scoreSubtext: {
    color: "#475569",
    fontSize: 14,
    marginTop: 4,
    fontWeight: "500",
  },
  scoreBarContainer: {
    width: "100%",
    marginTop: 16,
  },
  scoreBar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 3,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: "100%",
    borderRadius: 3,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 14,
    letterSpacing: -0.2,
  },

  // Stats Grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statItem: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.stone,
  },
  statItemLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statItemValue: {
    color: colors.heading,
    fontSize: 20,
    fontWeight: "600",
  },

  // Room Details
  roomCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.stone,
  },
  roomHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  roomName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.heading,
    flex: 1,
  },
  roomScoreBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  roomScore: {
    fontSize: 16,
    fontWeight: "600",
  },
  roomStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  roomStat: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "500",
  },
  roomStatDivider: {
    color: colors.stone,
    fontSize: 12,
  },
  roomFindingsStat: {
    color: colors.primary,
    fontWeight: "600",
  },
  roomCoverageBar: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 2,
    overflow: "hidden",
  },
  roomCoverageFill: {
    height: "100%",
    borderRadius: 2,
  },

  // Findings
  severityGroup: {
    marginBottom: 18,
  },
  severityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  severityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  severityLabel: {
    color: colors.heading,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
    letterSpacing: -0.2,
  },
  severityCountBadge: {
    backgroundColor: "rgba(107, 114, 128, 0.08)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  severityCount: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  findingRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 8,
    marginLeft: 18,
    overflow: "hidden",
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.stone,
  },
  findingAccent: {
    width: 4,
  },
  findingContent: {
    flex: 1,
    padding: 14,
  },
  findingDescription: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    fontWeight: "500",
  },
  findingRoom: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "500",
  },
  emptyFindings: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.stone,
  },
  emptyIcon: {
    fontSize: 24,
    color: "#334155",
    marginBottom: 8,
  },
  emptyText: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "500",
  },

  // Footer
  footer: {
    padding: 20,
    paddingBottom: 32,
  },
  completeButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  completeButtonText: {
    color: colors.primaryForeground,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
