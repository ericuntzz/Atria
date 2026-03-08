import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getProperties } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation";
import { colors, radius, shadows } from '../lib/tokens';

type Nav = NativeStackNavigationProp<RootStackParamList, "Properties">;

interface Property {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  trainingStatus: string;
  coverImageUrl: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
}

export default function PropertiesScreen() {
  const navigation = useNavigation<Nav>();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const MAX_AUTO_RETRIES = 2;

  const loadProperties = useCallback(async (isAutoRetry = false) => {
    try {
      setError(null);
      const data = await getProperties();
      setProperties(data);
      retryCountRef.current = 0; // Reset on success
    } catch (err) {
      console.error("Failed to load properties:", err);

      // Auto-retry on first failure (handles race conditions with auth init)
      if (isAutoRetry || retryCountRef.current >= MAX_AUTO_RETRIES) {
        const retryHint =
          Platform.OS === "web"
            ? "Tap here to retry."
            : "Pull to refresh.";
        setError(`Failed to load properties. ${retryHint}`);
      } else {
        retryCountRef.current += 1;
        // Short delay then auto-retry (covers auth init race conditions)
        setTimeout(() => loadProperties(true), 1500);
        return; // Don't clear loading state yet
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh every time screen is focused (e.g. after editing/deleting a property)
  useFocusEffect(
    useCallback(() => {
      loadProperties();
    }, [loadProperties]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadProperties();
  };

  const trainedCount = properties.filter(
    (p) => p.trainingStatus === "trained",
  ).length;

  const renderProperty = useCallback(({ item }: { item: Property }) => {
    const isTrained = item.trainingStatus === "trained";
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (isTrained) {
            navigation.navigate("InspectionStart", { propertyId: item.id });
          } else {
            navigation.navigate("PropertyTraining", {
              propertyId: item.id,
              propertyName: item.name,
            });
          }
        }}
        onLongPress={() => {
          navigation.navigate("PropertyDetail", { propertyId: item.id });
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${isTrained ? "ready for inspection" : "tap to train"}. Long press to edit.`}
      >
        {/* Color accent bar */}
        <View
          style={[
            styles.cardAccent,
            { backgroundColor: isTrained ? colors.success : colors.primary },
          ]}
        />

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleArea}>
              <Text style={styles.propertyName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.address && (
                <Text style={styles.address} numberOfLines={1}>
                  {item.address}
                  {item.city ? `, ${item.city}` : ""}
                  {item.state ? `, ${item.state}` : ""}
                </Text>
              )}
            </View>
            {/* Edit button */}
            <TouchableOpacity
              style={styles.editButton}
              onPress={() =>
                navigation.navigate("PropertyDetail", {
                  propertyId: item.id,
                })
              }
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>

          {/* Property details row */}
          <View style={styles.detailsRow}>
            <View
              style={[
                styles.badge,
                isTrained ? styles.badgeTrained : styles.badgeUntrained,
              ]}
            >
              <View
                style={[
                  styles.badgeDot,
                  {
                    backgroundColor: isTrained ? colors.success : colors.primary,
                  },
                ]}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: isTrained ? colors.success : colors.primary },
                ]}
              >
                {isTrained ? "Ready" : "Train"}
              </Text>
            </View>
            {item.bedrooms != null && (
              <View style={styles.detailChip}>
                <Text style={styles.detailText}>{item.bedrooms} bed</Text>
              </View>
            )}
            {item.bathrooms != null && (
              <View style={styles.detailChip}>
                <Text style={styles.detailText}>{item.bathrooms} bath</Text>
              </View>
            )}
            <View style={styles.detailChip}>
              <Text style={styles.detailText}>
                {isTrained ? "Tap to inspect" : "Tap to set up"}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading properties...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Properties</Text>
          <Text style={styles.subtitle}>
            {properties.length > 0
              ? `${trainedCount} of ${properties.length} ready`
              : "No properties yet"}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            Alert.alert("Sign Out", "Are you sure you want to sign out?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign Out",
                style: "destructive",
                onPress: () => supabase.auth.signOut(),
              },
            ]);
          }}
          style={styles.signOut}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={properties}
        keyExtractor={(item) => item.id}
        renderItem={renderProperty}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            {error ? (
              <TouchableOpacity
                style={styles.emptyRetryArea}
                onPress={() => {
                  setLoading(true);
                  retryCountRef.current = 0;
                  loadProperties();
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Retry loading properties"
              >
                <View style={styles.emptyIcon}>
                  <Text style={styles.emptyIconRetryText}>↻</Text>
                </View>
                <Text style={styles.emptyTitle}>{error}</Text>
                <View style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.emptyIcon}>
                  <Text style={styles.emptyIconText}>+</Text>
                </View>
                <Text style={styles.emptyTitle}>No properties yet</Text>
                <Text style={styles.emptySubtext}>
                  Add properties from the web dashboard to get started
                </Text>
              </>
            )}
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
  },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
    color: colors.heading,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: 2,
    fontWeight: "500",
  },
  signOut: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginTop: 4,
  },
  signOutText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },

  // List
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },

  // Card
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.stone,
    flexDirection: "row",
    ...shadows.card,
  },
  cardAccent: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: 18,
    paddingLeft: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  cardTitleArea: {
    flex: 1,
    marginRight: 12,
  },
  propertyName: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.heading,
    letterSpacing: -0.2,
  },
  address: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 3,
  },

  // Edit button
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  editButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },

  // Badge
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  badgeTrained: {
    backgroundColor: "rgba(74, 222, 128, 0.1)",
  },
  badgeUntrained: {
    backgroundColor: "rgba(77, 166, 255, 0.1)",
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // Details
  detailsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  detailChip: {
    backgroundColor: colors.secondary,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  detailText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
  },

  // Empty
  emptyContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(77, 166, 255, 0.08)",
    borderWidth: 2,
    borderColor: "rgba(77, 166, 255, 0.15)",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  emptyIconText: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: "300",
  },
  emptyRetryArea: {
    justifyContent: "center",
    alignItems: "center",
  },
  emptyIconRetryText: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: "400",
  },
  emptyTitle: {
    color: colors.muted,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "rgba(77, 166, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(77, 166, 255, 0.25)",
  },
  retryButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
});
