import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, SummaryData, SummaryRoomData } from "../navigation";
import FindingsPanel from "../components/FindingsPanel";
import CoverageTracker from "../components/CoverageTracker";
import { colors, radius } from '../lib/tokens';
import {
  SessionManager,
  type InspectionMode,
} from "../lib/inspection/session-manager";
import { ComparisonManager } from "../lib/vision/comparison-manager";
import { MotionFilter } from "../lib/sensors/motion-filter";
import { ChangeDetector } from "../lib/vision/change-detector";
import { getInspectionBaselines, submitBulkResults } from "../lib/api";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "InspectionCamera">;
type CameraRoute = RouteProp<RootStackParamList, "InspectionCamera">;

interface Finding {
  id: string;
  description: string;
  severity: string;
  confidence: number;
  category: string;
  status: "suggested" | "confirmed" | "dismissed" | "muted";
}

interface RoomBaseline {
  roomId: string;
  roomName: string;
  baselines: Array<{
    id: string;
    imageUrl: string;
    label: string | null;
    embedding: number[] | null;
  }>;
}

export default function InspectionCameraScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<CameraRoute>();
  const { inspectionId, propertyId, inspectionMode } = route.params;

  const [permission, requestPermission] = useCameraPermissions();
  const [paused, setPaused] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [coverage, setCoverage] = useState(0);
  const [roomAngles, setRoomAngles] = useState({ scanned: 0, total: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [roomWaypoints, setRoomWaypoints] = useState<
    Array<{ id: string; label: string | null; scanned: boolean }>
  >([]);
  const cameraRef = useRef<CameraView>(null);
  const autoCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Core engines
  const sessionRef = useRef<SessionManager | null>(null);
  const comparisonRef = useRef<ComparisonManager | null>(null);
  const motionFilterRef = useRef<MotionFilter | null>(null);
  const changeDetectorRef = useRef<ChangeDetector | null>(null);
  const baselinesRef = useRef<RoomBaseline[]>([]);

  // Initialize engines on mount
  useEffect(() => {
    const session = new SessionManager(
      inspectionId,
      propertyId,
      inspectionMode as InspectionMode,
    );
    sessionRef.current = session;

    const motionFilter = new MotionFilter();
    motionFilterRef.current = motionFilter;
    motionFilter.start();

    const changeDetector = new ChangeDetector();
    changeDetectorRef.current = changeDetector;

    const comparison = new ComparisonManager(motionFilter, changeDetector);
    comparisonRef.current = comparison;

    // Register finding callback
    comparison.onResult((result, roomId) => {
      if (result.findings?.length > 0) {
        for (const f of result.findings) {
          const findingId = session.addFinding(roomId, f);
          setFindings((prev) => [
            ...prev,
            {
              id: findingId,
              description: f.description,
              severity: f.severity,
              confidence: f.confidence,
              category: f.category,
              status: "suggested",
            },
          ]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
      }
      if (result.readiness_score != null) {
        session.updateRoomScore(roomId, result.readiness_score);
      }
    });

    comparison.onStatusChange((status) => {
      setIsProcessing(status === "processing");
    });

    // Load baselines
    loadBaselines(session);

    // Start auto-capture loop (every 5s, checks if conditions are met)
    autoCaptureTimerRef.current = setInterval(() => {
      if (session.isPaused()) return;
      if (!motionFilter.isStable()) return;
      if (comparison.isPaused()) return;

      const state = session.getState();
      if (!state.currentRoomId) return;

      // Auto-trigger capture when motion is stable
      // The manual capture handler checks all conditions
      // We just set a flag that the auto-loop is requesting a capture
      autoCaptureTick(session, comparison);
    }, 5000);

    return () => {
      motionFilter.stop();
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCoverageUI = useCallback(
    (session: SessionManager, roomId?: string) => {
      setCoverage(Math.round(session.getOverallCoverage()));
      if (roomId) {
        const state = session.getState();
        const visit = state.visitedRooms.get(roomId);
        const roomBaselines = baselinesRef.current.find(
          (r) => r.roomId === roomId,
        );

        if (visit && roomBaselines) {
          setRoomAngles({
            scanned: visit.anglesScanned.size,
            total: roomBaselines.baselines?.length || 0,
          });

          // Update waypoint data for CoverageTracker
          setRoomWaypoints(
            (roomBaselines.baselines || []).map((b) => ({
              id: b.id,
              label: b.label || null,
              scanned: visit.anglesScanned.has(b.id),
            })),
          );
        }
      }
    },
    [],
  );

  const loadBaselines = useCallback(
    async (session: SessionManager) => {
      try {
        const data = await getInspectionBaselines(inspectionId);

        // Map API response shape to our RoomBaseline interface.
        // API returns: rooms[].baselineImages[] (Drizzle column names)
        // We need:   rooms[].baselines[] with { id, imageUrl, label, embedding }
        interface ApiRoom {
          id: string;
          name: string;
          baselineImages?: Array<{
            id: string;
            imageUrl: string;
            label: string | null;
            embedding: number[] | null;
          }>;
        }

        const mappedRooms: RoomBaseline[] = ((data.rooms || []) as ApiRoom[]).map(
          (room) => ({
            roomId: room.id,
            roomName: room.name,
            baselines: (room.baselineImages || []).map((bl) => ({
              id: bl.id,
              imageUrl: bl.imageUrl,
              label: bl.label || null,
              embedding: bl.embedding || null,
            })),
          }),
        );

        baselinesRef.current = mappedRooms;

        const roomAnglesMap = new Map<string, number>();
        for (const room of mappedRooms) {
          roomAnglesMap.set(room.roomId, room.baselines?.length || 0);
        }
        session.setRoomAngles(roomAnglesMap);

        if (mappedRooms.length > 0) {
          const firstRoom = mappedRooms[0];
          session.enterRoom(firstRoom.roomId, firstRoom.roomName);
          setCurrentRoom(firstRoom.roomName);
          updateCoverageUI(session, firstRoom.roomId);
        }
      } catch (err) {
        console.error("Failed to load baselines:", err);
      }
    },
    [inspectionId, updateCoverageUI],
  );

  /**
   * Auto-capture tick — called by the interval timer.
   * Triggers a silent comparison if the camera is stable and cooldown elapsed.
   */
  const autoCaptureTick = useCallback(
    async (session: SessionManager, comparison: ComparisonManager) => {
      if (!cameraRef.current || paused) return;

      const state = session.getState();
      const currentRoomId = state.currentRoomId;
      if (!currentRoomId) return;

      const room = baselinesRef.current.find(
        (r) => r.roomId === currentRoomId,
      );
      if (!room?.baselines?.length) return;

      // Pick an unscanned angle, or fall back to first
      const visit = state.visitedRooms.get(currentRoomId);
      const unscanned = room.baselines.find(
        (b) => !visit?.anglesScanned.has(b.id),
      );
      const baseline = unscanned || room.baselines[0];

      // Record angle
      session.recordAngleScan(currentRoomId, baseline.id);
      updateCoverageUI(session, currentRoomId);

      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession?.access_token) return;

      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!apiUrl) return;

      comparison.triggerComparison(
        async () => {
          if (!cameraRef.current) return [];
          try {
            const photo = await cameraRef.current.takePictureAsync({
              quality: 0.7,
              base64: true,
            });
            if (photo?.base64) {
              return [`data:image/jpeg;base64,${photo.base64}`];
            }
          } catch {
            // Camera capture failed silently
          }
          return [];
        },
        baseline.imageUrl,
        room.roomName,
        currentRoomId,
        {
          inspectionMode,
          inspectionId,
          baselineImageId: baseline.id,
          apiUrl,
          authToken: authSession.access_token,
        },
      );
    },
    [paused, inspectionMode, inspectionId, updateCoverageUI],
  );

  // Manual room switching (until ONNX room detection is wired)
  const handleSwitchRoom = useCallback(() => {
    const rooms = baselinesRef.current;
    if (rooms.length === 0) return;

    const session = sessionRef.current;
    if (!session) return;

    const state = session.getState();
    const currentIdx = rooms.findIndex(
      (r) => r.roomId === state.currentRoomId,
    );
    const nextIdx = (currentIdx + 1) % rooms.length;
    const nextRoom = rooms[nextIdx];

    session.enterRoom(nextRoom.roomId, nextRoom.roomName);
    setCurrentRoom(nextRoom.roomName);
    updateCoverageUI(session, nextRoom.roomId);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [updateCoverageUI]);

  const handlePause = useCallback(() => {
    const session = sessionRef.current;
    const comparison = comparisonRef.current;
    if (!session || !comparison) return;

    setPaused((p) => {
      if (p) {
        session.resume();
        comparison.resume();
      } else {
        session.pause();
        comparison.pause();
      }
      return !p;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleEndInspection = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      navigation.replace("InspectionSummary", { inspectionId, propertyId });
      return;
    }

    const state = session.getState();
    const results: Array<{
      roomId: string;
      baselineImageId: string;
      currentImageUrl: string;
      score: number;
      findings: Array<{
        description: string;
        severity: string;
        confidence: number;
        category: string;
        isClaimable: boolean;
      }>;
    }> = [];

    for (const [roomId, visit] of state.visitedRooms) {
      const roomBaselines = baselinesRef.current.find(
        (r) => r.roomId === roomId,
      );
      const firstBaseline = roomBaselines?.baselines?.[0];

      results.push({
        roomId,
        baselineImageId: firstBaseline?.id || roomId,
        currentImageUrl: "",
        score: visit.bestScore ?? 100,
        findings: visit.findings
          .filter((f) => f.status === "confirmed")
          .map((f) => ({
            description: f.description,
            severity: f.severity,
            confidence: f.confidence,
            category: f.category,
            isClaimable: f.isClaimable || false,
          })),
      });
    }

    try {
      if (results.length > 0) {
        await submitBulkResults(
          inspectionId,
          results,
          session.getCompletionTier(),
        );
      }
    } catch (err) {
      console.error("Failed to submit results:", err);
    }

    // Build summary data from session state
    const summaryRooms: SummaryRoomData[] = [];
    const allConfirmed: SummaryData["confirmedFindings"] = [];

    for (const [roomId, visit] of state.visitedRooms) {
      const roomBaseline = baselinesRef.current.find((r) => r.roomId === roomId);
      const anglesTotal = roomBaseline?.baselines?.length || 0;

      const roomFindings = visit.findings.map((f) => ({
        id: f.id,
        description: f.description,
        severity: f.severity,
        confidence: f.confidence,
        category: f.category,
        status: f.status,
      }));

      const confirmed = visit.findings.filter((f) => f.status === "confirmed");
      for (const cf of confirmed) {
        allConfirmed.push({
          id: cf.id,
          description: cf.description,
          severity: cf.severity,
          confidence: cf.confidence,
          category: cf.category,
          roomName: visit.roomName,
        });
      }

      summaryRooms.push({
        roomId,
        roomName: visit.roomName,
        score: visit.bestScore,
        coverage: anglesTotal > 0 ? Math.round((visit.anglesScanned.size / anglesTotal) * 100) : 0,
        anglesScanned: visit.anglesScanned.size,
        anglesTotal,
        confirmedFindings: confirmed.length,
        findings: roomFindings,
      });
    }

    const summaryData: SummaryData = {
      overallScore: session.getOverallScore(),
      completionTier: session.getCompletionTier(),
      overallCoverage: Math.round(session.getOverallCoverage()),
      durationMs: session.getDurationMs(),
      inspectionMode: inspectionMode,
      rooms: summaryRooms,
      confirmedFindings: allConfirmed,
    };

    navigation.replace("InspectionSummary", {
      inspectionId,
      propertyId,
      summaryData,
    });
  }, [navigation, inspectionId, propertyId, inspectionMode]);

  // Intercept Android hardware back button to prevent data loss
  useEffect(() => {
    const onBackPress = () => {
      Alert.alert(
        "End Inspection",
        "Are you sure you want to end this inspection?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "End",
            style: "destructive",
            onPress: handleEndInspection,
          },
        ],
      );
      return true; // Prevent default back behavior
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => sub.remove();
  }, [handleEndInspection]);

  // Manual capture trigger
  const handleManualCapture = useCallback(async () => {
    const session = sessionRef.current;
    const comparison = comparisonRef.current;
    if (!session || !comparison || !cameraRef.current || paused) return;

    const state = session.getState();
    const currentRoomId = state.currentRoomId;
    if (!currentRoomId) return;

    const room = baselinesRef.current.find((r) => r.roomId === currentRoomId);
    if (!room?.baselines?.length) return;

    const visit = state.visitedRooms.get(currentRoomId);
    const unscanned = room.baselines.find(
      (b) => !visit?.anglesScanned.has(b.id),
    );
    const baseline = unscanned || room.baselines[0];

    // Record angle as scanned
    session.recordAngleScan(currentRoomId, baseline.id);
    updateCoverageUI(session, currentRoomId);

    // Flash feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const {
      data: { session: authSession },
    } = await supabase.auth.getSession();
    if (!authSession?.access_token) return;

    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) return;

    comparison.triggerComparison(
      async () => {
        if (!cameraRef.current) return [];
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.7,
            base64: true,
          });
          if (photo?.base64) {
            return [`data:image/jpeg;base64,${photo.base64}`];
          }
        } catch {
          // Camera capture failed
        }
        return [];
      },
      baseline.imageUrl,
      room.roomName,
      currentRoomId,
      {
        inspectionMode,
        inspectionId,
        baselineImageId: baseline.id,
        apiUrl,
        authToken: authSession.access_token,
      },
    );
  }, [paused, inspectionMode, inspectionId, updateCoverageUI]);

  const handleConfirmFinding = useCallback((findingId: string) => {
    sessionRef.current?.updateFindingStatus(findingId, "confirmed");
    setFindings((prev) =>
      prev.map((f) =>
        f.id === findingId ? { ...f, status: "confirmed" as const } : f,
      ),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handleDismissFinding = useCallback((findingId: string) => {
    sessionRef.current?.updateFindingStatus(findingId, "dismissed");
    setFindings((prev) =>
      prev.map((f) =>
        f.id === findingId ? { ...f, status: "dismissed" as const } : f,
      ),
    );
  }, []);

  const handleMuteFinding = useCallback((findingId: string) => {
    sessionRef.current?.updateFindingStatus(findingId, "muted");
    setFindings((prev) =>
      prev.map((f) =>
        f.id === findingId ? { ...f, status: "muted" as const } : f,
      ),
    );
  }, []);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission?.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera access is required</Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Top HUD — rendered OUTSIDE CameraView so touches work on iOS */}
      <SafeAreaView style={styles.topHud}>
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.endButton}
              onPress={() => {
                Alert.alert(
                  "End Inspection",
                  "Are you sure you want to end this inspection?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "End",
                      style: "destructive",
                      onPress: handleEndInspection,
                    },
                  ],
                );
              }}
            >
              <Text style={styles.endButtonText}>← End</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roomBadge}
              onPress={handleSwitchRoom}
              activeOpacity={0.7}
            >
              <Text style={styles.roomName}>
                {currentRoom || "Scanning..."}
              </Text>
              {roomAngles.total > 0 && (
                <Text style={styles.angleCount}>
                  {roomAngles.scanned}/{roomAngles.total} angles
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.recBadge}>
              <View
                style={[
                  styles.recDot,
                  isProcessing && styles.recDotProcessing,
                ]}
              />
              <Text style={styles.recText}>
                {isProcessing ? "AI" : "REC"}
              </Text>
            </View>
          </View>

          <View style={styles.coverageRow}>
            <CoverageTracker
              coverage={coverage}
              currentRoomName={currentRoom || undefined}
              roomWaypoints={roomWaypoints}
            />
          </View>
        </SafeAreaView>

        {/* Pause overlay */}
        {paused && (
          <View style={styles.pauseOverlay}>
            <Text style={styles.pauseText}>PAUSED</Text>
            <Text style={styles.pauseSubtext}>Tap Resume to continue</Text>
          </View>
        )}

        {/* Bottom controls */}
        <SafeAreaView style={styles.bottomControls}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleManualCapture}
            disabled={paused || isProcessing}
            activeOpacity={0.6}
          >
            <View
              style={[
                styles.captureRing,
                isProcessing && styles.captureRingProcessing,
              ]}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.pauseButton} onPress={handlePause}>
            <Text style={styles.pauseButtonText}>
              {paused ? "▶ Resume" : "⏸ Pause"}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>

      {/* Findings Panel */}
      <FindingsPanel
        findings={findings.filter(
          (f) => f.status === "suggested" || f.status === "confirmed",
        )}
        onConfirm={handleConfirmFinding}
        onDismiss={handleDismissFinding}
        onMute={handleMuteFinding}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  topHud: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  endButton: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  endButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  roomBadge: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(77,166,255,0.3)",
  },
  roomName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  angleCount: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ef4444",
  },
  recDotProcessing: {
    backgroundColor: colors.primary,
  },
  recText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  coverageRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 15,
  },
  pauseText: {
    color: colors.primary,
    fontSize: 36,
    fontWeight: "600",
    letterSpacing: 6,
  },
  pauseSubtext: {
    color: "#94a3b8",
    fontSize: 15,
    marginTop: 10,
    fontWeight: "500",
  },
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: 24,
    zIndex: 10,
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  captureRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    borderColor: "#fff",
  },
  captureRingProcessing: {
    borderColor: colors.primary,
  },
  pauseButton: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pauseButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  permissionText: {
    color: "#fff",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  permissionButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "600",
  },
});
