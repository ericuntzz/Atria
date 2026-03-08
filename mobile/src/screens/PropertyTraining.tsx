/**
 * PropertyTraining.tsx — Baseline Capture Flow
 *
 * Training mode captures the property in its ideal state.
 * The user walks through and captures images from different angles.
 * The AI analyzes the images and creates rooms, items, and baselines.
 *
 * Flow:
 * 1. Instructions + "Start Capture" button
 * 2. Camera view for capturing images (3-15+ images)
 * 3. Thumbnails showing captured images with count
 * 4. "Done Capturing" -> uploads all images -> triggers AI training
 * 5. Results screen showing detected rooms and items
 */

import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation";
import { uploadBase64Image, trainProperty } from "../lib/api";
import { colors, radius, shadows } from '../lib/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, "PropertyTraining">;
type TrainingRoute = RouteProp<RootStackParamList, "PropertyTraining">;

type TrainingPhase = "intro" | "capturing" | "uploading" | "training" | "results";

interface CapturedImage {
  id: string;
  base64: string;
  uri: string;
}

interface TrainingResult {
  rooms: Array<{
    name: string;
    roomType: string;
    items: Array<{ name: string; category: string }>;
    baselineCount: number;
  }>;
  totalRooms: number;
  totalItems: number;
}

export default function PropertyTrainingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TrainingRoute>();
  const { propertyId, propertyName } = route.params;

  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<TrainingPhase>("intro");
  const [captures, setCaptures] = useState<CapturedImage[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  const handleStartCapture = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          "Camera Required",
          "Camera access is needed to capture baseline images for training.",
        );
        return;
      }
    }
    setPhase("capturing");
  }, [permission, requestPermission]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
      });

      if (photo?.base64 && photo?.uri) {
        const newCapture: CapturedImage = {
          id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          base64: photo.base64,
          uri: photo.uri,
        };
        setCaptures((prev) => [...prev, newCapture]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.error("Capture failed:", err);
    }
  }, []);

  const handleRemoveCapture = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleUploadAndTrain = useCallback(async () => {
    setPhase("uploading");
    setError(null);
    const total = captures.length;
    setUploadProgress({ current: 0, total });

    const mediaUploadIds: string[] = [];

    try {
      // Upload all images
      for (let i = 0; i < captures.length; i++) {
        const capture = captures[i];
        setUploadProgress({ current: i + 1, total });

        const result = await uploadBase64Image(
          `data:image/jpeg;base64,${capture.base64}`,
          propertyId,
          `training-${i + 1}.jpg`,
        );
        mediaUploadIds.push(result.id);
      }

      // Trigger training
      setPhase("training");
      const result = await trainProperty(propertyId, mediaUploadIds);
      setTrainingResult(result);
      setPhase("results");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Training failed:", err);
      setError(
        err instanceof Error ? err.message : "Training failed. Please try again.",
      );
      setPhase("capturing");
    }
  }, [captures, propertyId]);

  const handleDoneCapturing = useCallback(() => {
    if (captures.length < 3) {
      Alert.alert(
        "More Images Needed",
        "Please capture at least 3 images from different rooms and angles for accurate training.",
      );
      return;
    }

    Alert.alert(
      "Start Training",
      `Upload ${captures.length} images and train AI on this property? This may take a minute.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Train", style: "default", onPress: handleUploadAndTrain },
      ],
    );
  }, [captures.length, handleUploadAndTrain]);

  // ──── Intro Phase ────
  if (phase === "intro") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.introContent}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonText}>{"<"} Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Train Property</Text>
          <Text style={styles.propertyLabel}>{propertyName}</Text>

          <View style={styles.instructionCard}>
            <Text style={styles.instructionTitle}>How Training Works</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepCircle}>
                <Text style={styles.stepNumber}>1</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Walk Through</Text>
                <Text style={styles.stepText}>
                  Capture images of each room from different angles
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepCircle}>
                <Text style={styles.stepNumber}>2</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Capture Angles</Text>
                <Text style={styles.stepText}>
                  Take 3-5 images per room showing key areas
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepCircle}>
                <Text style={styles.stepNumber}>3</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>AI Analysis</Text>
                <Text style={styles.stepText}>
                  AI identifies rooms, items, and creates inspection baselines
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>Tips for Best Results</Text>
            <Text style={styles.tipText}>
              {"\u2022"} Turn on all lights for even illumination{"\n"}
              {"\u2022"} Hold phone steady for sharp captures{"\n"}
              {"\u2022"} Property should be in guest-ready state{"\n"}
              {"\u2022"} Include all rooms, outdoor areas, and closets{"\n"}
              {"\u2022"} More images = more accurate inspections
            </Text>
          </View>

          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartCapture}
            activeOpacity={0.8}
          >
            <Text style={styles.startButtonText}>Start Capture</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ──── Uploading / Training Phase ────
  if (phase === "uploading" || phase === "training") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.processingContainer}>
          <View style={styles.processingIconCircle}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={styles.processingTitle}>
            {phase === "uploading" ? "Uploading Images" : "Training AI"}
          </Text>
          <Text style={styles.processingSubtext}>
            {phase === "uploading"
              ? `${uploadProgress.current} of ${uploadProgress.total} images`
              : "Analyzing rooms, items, and baselines..."}
          </Text>
          {phase === "uploading" && (
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressPercent}>
                {uploadProgress.total > 0
                  ? Math.round((uploadProgress.current / uploadProgress.total) * 100)
                  : 0}
                %
              </Text>
            </View>
          )}
          <Text style={styles.processingHint}>
            This may take up to a minute
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ──── Results Phase ────
  if (phase === "results" && trainingResult) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.resultsContent}>
          {/* Success Header */}
          <View style={styles.successHeader}>
            <View style={styles.successCircle}>
              <Text style={styles.successCheck}>{">"}</Text>
            </View>
            <Text style={styles.resultsTitle}>Training Complete</Text>
            <Text style={styles.resultsSubtitle}>
              {propertyName} is ready for inspections
            </Text>
          </View>

          {/* Summary Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{trainingResult.totalRooms}</Text>
              <Text style={styles.statLabel}>Rooms</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{trainingResult.totalItems}</Text>
              <Text style={styles.statLabel}>Items</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{captures.length}</Text>
              <Text style={styles.statLabel}>Baselines</Text>
            </View>
          </View>

          {/* Room Details */}
          <Text style={styles.sectionTitle}>Detected Rooms</Text>
          {trainingResult.rooms.map((room, idx) => (
            <View key={idx} style={styles.roomCard}>
              <View style={styles.roomHeader}>
                <Text style={styles.roomName}>{room.name}</Text>
                <View style={styles.roomTypeBadge}>
                  <Text style={styles.roomTypeText}>{room.roomType}</Text>
                </View>
              </View>
              {room.items.length > 0 && (
                <Text style={styles.roomItems}>
                  {room.items.map((i) => i.name).join(" \u2022 ")}
                </Text>
              )}
              <Text style={styles.roomBaselines}>
                {room.baselineCount} baseline image{room.baselineCount !== 1 ? "s" : ""}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.resultsFooter}>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.popToTop()}
            activeOpacity={0.8}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ──── Permission Check ────
  if (!permission?.granted) {
    return (
      <View style={styles.permissionContainer}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>Camera Access</Text>
          <Text style={styles.permissionText}>
            Camera access is required to capture baseline images for property training.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ──── Capturing Phase ────
  return (
    <View style={styles.container}>
      {/* Camera fills the entire screen */}
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Top Bar — rendered OUTSIDE CameraView so touches work on iOS */}
      <SafeAreaView style={styles.cameraTopBar}>
        <TouchableOpacity
          style={styles.cameraBackButton}
          onPress={() => {
            if (captures.length > 0) {
              Alert.alert(
                "Discard Captures?",
                `You have ${captures.length} captured images. Going back will discard them.`,
                [
                  { text: "Keep Capturing", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => setPhase("intro"),
                  },
                ],
              );
            } else {
              setPhase("intro");
            }
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.cameraBackText}>{"<"} Back</Text>
        </TouchableOpacity>

        <View style={styles.captureCountBadge}>
          <Text style={styles.captureCountText}>
            {captures.length} captured
          </Text>
        </View>

        <View style={styles.trainingBadge}>
          <View style={styles.trainingDot} />
          <Text style={styles.trainingBadgeText}>TRAINING</Text>
        </View>
      </SafeAreaView>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Guidance text */}
      <View style={styles.guidanceContainer} pointerEvents="none">
        <Text style={styles.guidanceText}>
          {captures.length === 0
            ? "Point at the first room and tap capture"
            : captures.length < 3
              ? `Capture ${3 - captures.length} more image${3 - captures.length !== 1 ? "s" : ""} (minimum)`
              : "Keep capturing or tap Done when finished"}
        </Text>
      </View>

      {/* Bottom Controls */}
      <SafeAreaView style={styles.cameraBottomControls}>
        {/* Thumbnail strip */}
        {captures.length > 0 && (
          <FlatList
            data={captures}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.thumbnailStrip}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.thumbnail}
                onLongPress={() => {
                  Alert.alert("Remove Image", "Remove this capture?", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => handleRemoveCapture(item.id),
                    },
                  ]);
                }}
              >
                <Image source={{ uri: item.uri }} style={styles.thumbnailImage} />
              </TouchableOpacity>
            )}
          />
        )}

        <View style={styles.captureRow}>
          <TouchableOpacity
            style={[
              styles.finishButton,
              captures.length < 3 && styles.finishButtonDisabled,
            ]}
            onPress={handleDoneCapturing}
            disabled={captures.length < 3}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.finishButtonText,
                captures.length < 3 && styles.finishButtonTextDisabled,
              ]}
            >
              Done ({captures.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            activeOpacity={0.6}
          >
            <View style={styles.captureRing} />
          </TouchableOpacity>

          <View style={styles.captureSpacer} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── Intro Phase ──
  introContent: {
    flex: 1,
    padding: 20,
    paddingTop: 12,
  },
  backButton: {
    marginBottom: 20,
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonText: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: "500",
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
    color: colors.heading,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  propertyLabel: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: "600",
    marginBottom: 28,
  },
  instructionCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 22,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.stone,
  },
  instructionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 20,
    letterSpacing: -0.2,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 18,
    gap: 14,
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(77, 166, 255, 0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(77, 166, 255, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumber: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  stepContent: {
    flex: 1,
    paddingTop: 2,
  },
  stepTitle: {
    color: colors.heading,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  stepText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  tipCard: {
    backgroundColor: "rgba(77, 166, 255, 0.06)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "rgba(77, 166, 255, 0.12)",
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
    marginBottom: 10,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  tipText: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 24,
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: "auto",
    marginBottom: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  startButtonText: {
    color: colors.primaryForeground,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // ── Processing Phase ──
  processingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  processingIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(77, 166, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(77, 166, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 28,
  },
  processingTitle: {
    color: colors.heading,
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  processingSubtext: {
    color: "#94a3b8",
    fontSize: 16,
    marginBottom: 28,
  },
  progressBarContainer: {
    width: "80%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.stone,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressPercent: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
    minWidth: 40,
    textAlign: "right",
  },
  processingHint: {
    color: "#475569",
    fontSize: 13,
  },

  // ── Results Phase ──
  resultsContent: {
    padding: 20,
    paddingTop: 32,
  },
  successHeader: {
    alignItems: "center",
    marginBottom: 28,
  },
  successCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderWidth: 2,
    borderColor: "rgba(34, 197, 94, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  successCheck: {
    color: "#22c55e",
    fontSize: 24,
    fontWeight: "600",
  },
  resultsTitle: {
    fontSize: 28,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  resultsSubtitle: {
    fontSize: 15,
    color: "#22c55e",
    fontWeight: "500",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.stone,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "600",
    color: colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
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
    marginBottom: 8,
  },
  roomName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.heading,
    flex: 1,
  },
  roomTypeBadge: {
    backgroundColor: "rgba(77, 166, 255, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roomTypeText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
  },
  roomItems: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 6,
  },
  roomBaselines: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "500",
  },
  resultsFooter: {
    padding: 20,
    paddingBottom: 32,
  },
  doneButton: {
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
  doneButtonText: {
    color: colors.primaryForeground,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // ── Camera Capture Phase ──
  cameraTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 10,
  },
  cameraBackButton: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cameraBackText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  captureCountBadge: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(77,166,255,0.3)",
  },
  captureCountText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  trainingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.2)",
  },
  trainingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  trainingBadgeText: {
    color: "#22c55e",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  errorBanner: {
    position: "absolute",
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: "rgba(239, 68, 68, 0.92)",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 20,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
  },
  errorText: {
    color: "#fff",
    fontSize: 14,
    flex: 1,
    marginRight: 8,
    fontWeight: "500",
  },
  errorDismiss: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  guidanceContainer: {
    position: "absolute",
    top: "38%",
    left: 20,
    right: 20,
    alignItems: "center",
    zIndex: 5,
  },
  guidanceText: {
    backgroundColor: "rgba(0,0,0,0.65)",
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cameraBottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  thumbnailStrip: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
    paddingBottom: 28,
  },
  finishButton: {
    backgroundColor: "rgba(77, 166, 255, 0.92)",
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingVertical: 14,
    minWidth: 100,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(77, 166, 255, 0.5)",
  },
  finishButtonDisabled: {
    backgroundColor: "rgba(100, 116, 139, 0.35)",
    borderColor: "rgba(100, 116, 139, 0.2)",
  },
  finishButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "600",
  },
  finishButtonTextDisabled: {
    color: "#94a3b8",
  },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
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
  captureSpacer: {
    minWidth: 100,
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  permissionCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.stone,
    maxWidth: 340,
    width: "100%",
  },
  permissionTitle: {
    color: colors.heading,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  permissionText: {
    color: "#94a3b8",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
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
