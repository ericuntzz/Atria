import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { baselineImages, baselineVersions, rooms } from "@/server/schema";
import { fetchImageBuffer } from "@/lib/vision/fetch-image";
import { computeQualityScore } from "@/lib/vision/quality";
import { generateEmbeddingWithOptions, getModelVersion } from "@/lib/vision/embeddings";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const VERIFICATION_WIDTH = 480;
const VERIFICATION_HEIGHT = 360;
const STORAGE_UPLOAD_RETRIES = 3;

function createStorageAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isBucketMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("not found") || normalized.includes("bucket");
}

function isTransientUploadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket")
  );
}

async function uploadToPropertyMediaWithRetry(
  supabase: SupabaseClient,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string | null> {
  let lastMessage = "Upload failed";

  for (let attempt = 1; attempt <= STORAGE_UPLOAD_RETRIES; attempt++) {
    const { error } = await supabase.storage
      .from("property-media")
      .upload(path, data, { contentType, upsert: true });

    if (!error) {
      const {
        data: { publicUrl },
      } = supabase.storage.from("property-media").getPublicUrl(path);
      return publicUrl;
    }

    lastMessage = error.message || lastMessage;

    if (isBucketMissingError(lastMessage)) {
      await supabase.storage.createBucket("property-media", { public: true }).catch(() => {});
      continue;
    }

    if (isTransientUploadError(lastMessage) && attempt < STORAGE_UPLOAD_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      continue;
    }

    break;
  }

  console.warn("[backfill] Failed to upload derived baseline asset:", lastMessage);
  return null;
}

async function generateDerivedBaselineAssets(
  supabase: SupabaseClient | null,
  propertyId: string,
  baselineId: string,
  imageUrl: string,
): Promise<{ previewUrl?: string; verificationImageUrl?: string }> {
  if (!supabase) return {};

  const sourceBuffer = await fetchImageBuffer(imageUrl);
  if (!sourceBuffer) return {};

  const [previewBuffer, verificationBuffer] = await Promise.all([
    sharp(sourceBuffer)
      .rotate()
      .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 82 })
      .toBuffer(),
    sharp(sourceBuffer)
      .rotate()
      .resize(VERIFICATION_WIDTH, VERIFICATION_HEIGHT, {
        fit: "cover",
        position: "centre",
      })
      .greyscale()
      .png()
      .toBuffer(),
  ]);

  const previewPath = `${propertyId}/baseline-assets/${baselineId}-preview.jpg`;
  const verificationPath = `${propertyId}/baseline-assets/${baselineId}-verify.png`;

  const [previewUrl, verificationImageUrl] = await Promise.all([
    uploadToPropertyMediaWithRetry(supabase, previewPath, previewBuffer, "image/jpeg"),
    uploadToPropertyMediaWithRetry(supabase, verificationPath, verificationBuffer, "image/png"),
  ]);
  const versionTag = Date.now();

  return {
    previewUrl: previewUrl ? `${previewUrl}?v=${versionTag}` : undefined,
    verificationImageUrl: verificationImageUrl ? `${verificationImageUrl}?v=${versionTag}` : undefined,
  };
}

async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(
        `[backfill] ${label} attempt ${attempt} failed:`,
        error instanceof Error ? error.message : error,
      );

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main() {
  const propertyId = process.argv[2];
  const forceRefresh = process.argv.includes("--force");
  if (!propertyId) {
    throw new Error("Usage: npx tsx scripts/backfill-property-baselines.ts <property-id> [--force]");
  }

  const [activeVersion] = await db
    .select({ id: baselineVersions.id })
    .from(baselineVersions)
    .where(
      and(
        eq(baselineVersions.propertyId, propertyId),
        eq(baselineVersions.isActive, true),
      ),
    )
    .limit(1);

  if (!activeVersion) {
    throw new Error(`No active baseline version found for property ${propertyId}`);
  }

  const propertyRooms = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.propertyId, propertyId));
  const roomIds = propertyRooms.map((row) => row.id);

  const brokenBaselines = roomIds.length > 0
    ? await db
        .select({
          id: baselineImages.id,
          imageUrl: baselineImages.imageUrl,
        })
        .from(baselineImages)
        .where(
          and(
            inArray(baselineImages.roomId, roomIds),
            eq(baselineImages.isActive, true),
            forceRefresh
              ? undefined
              : or(
                  isNull(baselineImages.baselineVersionId),
                  isNull(baselineImages.embedding),
                  isNull(baselineImages.previewUrl),
                  isNull(baselineImages.verificationImageUrl),
                ),
          ),
        )
    : [];

  console.info(
    `[backfill] Found ${brokenBaselines.length} ${forceRefresh ? "active" : "incomplete"} baselines for property ${propertyId}`,
  );

  const storageAdmin = createStorageAdminClient();

  for (const baseline of brokenBaselines) {
    console.info(`[backfill] Processing ${baseline.id}`);

    const [embedding, qualityScore, derivedAssets] = await Promise.all([
      withRetries(
        `embedding ${baseline.id}`,
        () => generateEmbeddingWithOptions(baseline.imageUrl, { allowPlaceholder: false }),
      ),
      computeQualityScore(baseline.imageUrl),
      generateDerivedBaselineAssets(
        storageAdmin,
        propertyId,
        baseline.id,
        baseline.imageUrl,
      ),
    ]);

    await db
      .update(baselineImages)
      .set({
        baselineVersionId: activeVersion.id,
        embedding,
        qualityScore,
        embeddingModelVersion: getModelVersion(),
        previewUrl: derivedAssets.previewUrl ?? null,
        verificationImageUrl: derivedAssets.verificationImageUrl ?? null,
      })
      .where(eq(baselineImages.id, baseline.id));
  }

  const summary = roomIds.length > 0
    ? await db
        .select({
          id: baselineImages.id,
          embedding: baselineImages.embedding,
          previewUrl: baselineImages.previewUrl,
          verificationImageUrl: baselineImages.verificationImageUrl,
          baselineVersionId: baselineImages.baselineVersionId,
        })
        .from(baselineImages)
        .where(inArray(baselineImages.roomId, roomIds))
    : [];

  const completeCount = summary.filter(
    (row) =>
      row.embedding &&
      row.previewUrl &&
      row.verificationImageUrl &&
      row.baselineVersionId,
  ).length;

  console.info(
    `[backfill] Complete baselines after repair: ${completeCount}/${summary.length}`,
  );
}

main().catch((error) => {
  console.error("[backfill] Failed:", error);
  process.exit(1);
});
