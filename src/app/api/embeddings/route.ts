import { NextRequest, NextResponse } from "next/server";
import { getDbUser, isValidUUID } from "@/lib/auth";
import { db } from "@/server/db";
import { baselineImages, rooms, properties } from "@/server/schema";
import { eq, and, inArray } from "drizzle-orm";

const MAX_EMBEDDINGS_PER_REQUEST = 500;

/**
 * POST /api/embeddings
 *
 * Generate and store embeddings for baseline images.
 * Phase 1 implementation uses a placeholder embedding generator.
 * Will be replaced with actual MobileCLIP-S0 ONNX inference when the model is bundled.
 *
 * Body:
 *   { imageIds: string[] }             — generate embeddings for specific baseline images
 *   { propertyId: string }             — generate embeddings for all baselines of a property
 *   { imageUrls: string[] }            — generate embeddings for arbitrary images (returns without storing)
 */
export async function POST(request: NextRequest) {
  try {
  const dbUser = await getDbUser();
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { imageIds, propertyId, imageUrls } = body;

  // Mode 1: Generate embeddings for arbitrary image URLs (no storage)
  if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
    if (imageUrls.length > MAX_EMBEDDINGS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many URLs. Maximum is ${MAX_EMBEDDINGS_PER_REQUEST}` },
        { status: 400 },
      );
    }
    // Validate all elements are strings
    for (const url of imageUrls) {
      if (typeof url !== "string") {
        return NextResponse.json(
          { error: "All imageUrls must be strings" },
          { status: 400 },
        );
      }
    }
    const embeddings = await Promise.all(
      imageUrls.map(async (url: string) => ({
        url,
        embedding: await generateEmbedding(url),
        modelVersion: EMBEDDING_MODEL_VERSION,
      })),
    );

    return NextResponse.json({ embeddings });
  }

  // Mode 2: Generate embeddings for specific baseline image IDs
  if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
    // Validate UUIDs
    for (const id of imageIds) {
      if (typeof id !== "string" || !isValidUUID(id)) {
        return NextResponse.json(
          { error: `Invalid image ID: ${id}` },
          { status: 400 },
        );
      }
    }

    const images = await db
      .select({
        id: baselineImages.id,
        imageUrl: baselineImages.imageUrl,
        roomId: baselineImages.roomId,
      })
      .from(baselineImages)
      .where(inArray(baselineImages.id, imageIds as string[]));

    if (images.length === 0) {
      return NextResponse.json(
        { error: "No matching baseline images found" },
        { status: 404 },
      );
    }

    // Verify user owns the property these baselines belong to
    const roomIds = [...new Set(images.map((img) => img.roomId))];
    const roomRecords = await db
      .select({ id: rooms.id, propertyId: rooms.propertyId })
      .from(rooms)
      .where(inArray(rooms.id, roomIds));

    const propertyIds = [...new Set(roomRecords.map((r) => r.propertyId))];
    for (const pid of propertyIds) {
      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, pid), eq(properties.userId, dbUser.id)));

      if (!prop) {
        return NextResponse.json(
          { error: "Unauthorized — you do not own this property" },
          { status: 403 },
        );
      }
    }

    // Generate and store embeddings
    const results = [];
    for (const image of images) {
      const embedding = await generateEmbedding(image.imageUrl);
      const qualityScore = await computeQualityScore(image.imageUrl);

      await db
        .update(baselineImages)
        .set({
          embedding,
          qualityScore,
          embeddingModelVersion: EMBEDDING_MODEL_VERSION,
        })
        .where(eq(baselineImages.id, image.id));

      results.push({
        id: image.id,
        embeddingDimensions: embedding.length,
        qualityScore,
        modelVersion: EMBEDDING_MODEL_VERSION,
      });
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  }

  // Mode 3: Generate embeddings for all baselines of a property
  if (propertyId && typeof propertyId === "string") {
    if (!isValidUUID(propertyId)) {
      return NextResponse.json(
        { error: "Invalid propertyId" },
        { status: 400 },
      );
    }

    // Verify ownership
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(eq(properties.id, propertyId), eq(properties.userId, dbUser.id)),
      );

    if (!prop) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 },
      );
    }

    // Get all rooms for this property
    const propertyRooms = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.propertyId, propertyId));

    if (propertyRooms.length === 0) {
      return NextResponse.json(
        { error: "Property has no rooms" },
        { status: 400 },
      );
    }

    const roomIds = propertyRooms.map((r) => r.id);
    const images = await db
      .select({
        id: baselineImages.id,
        imageUrl: baselineImages.imageUrl,
      })
      .from(baselineImages)
      .where(inArray(baselineImages.roomId, roomIds));

    if (images.length === 0) {
      return NextResponse.json(
        { error: "No baseline images found" },
        { status: 400 },
      );
    }

    // Limit to prevent abuse
    if (images.length > MAX_EMBEDDINGS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many images (${images.length}). Maximum ${MAX_EMBEDDINGS_PER_REQUEST} per request.` },
        { status: 400 },
      );
    }

    // Generate and store embeddings for all
    const results = [];
    for (const image of images) {
      const embedding = await generateEmbedding(image.imageUrl);
      const qualityScore = await computeQualityScore(image.imageUrl);

      await db
        .update(baselineImages)
        .set({
          embedding,
          qualityScore,
          embeddingModelVersion: EMBEDDING_MODEL_VERSION,
        })
        .where(eq(baselineImages.id, image.id));

      results.push({
        id: image.id,
        embeddingDimensions: embedding.length,
        qualityScore,
        modelVersion: EMBEDDING_MODEL_VERSION,
      });
    }

    return NextResponse.json({
      propertyId,
      processed: results.length,
      results,
    });
  }

  return NextResponse.json(
    {
      error:
        "Request must include one of: imageIds (string[]), propertyId (string), or imageUrls (string[])",
    },
    { status: 400 },
  );
  } catch (error) {
    console.error("[embeddings] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Current embedding model version.
 * When the model changes, increment this and flag old embeddings for regeneration.
 */
const EMBEDDING_MODEL_VERSION = "mobileclip-s0-placeholder-v1";

/**
 * Generate a 512-dimensional embedding for an image.
 *
 * Phase 1: Deterministic placeholder based on image URL hash.
 * This produces consistent embeddings for the same URL, enabling
 * the full pipeline to work end-to-end while we integrate the real
 * MobileCLIP-S0 ONNX model.
 *
 * Phase 2: Replace with onnxruntime-node MobileCLIP-S0 inference.
 * The same model file must be used on both server and mobile to ensure
 * embedding consistency (cosine similarity scores depend on identical weights).
 */
async function generateEmbedding(imageUrl: string): Promise<number[]> {
  // Deterministic hash-based embedding from URL
  // This ensures the same image always gets the same embedding
  const embedding = new Array(512);
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) {
    const char = imageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  for (let i = 0; i < 512; i++) {
    // Use a seeded pseudo-random number generator for determinism
    hash = ((hash << 13) ^ hash) | 0;
    hash = (hash * 0x5bd1e995) | 0;
    hash = ((hash >> 15) ^ hash) | 0;
    embedding[i] = (hash & 0xffff) / 0xffff - 0.5; // Normalize to [-0.5, 0.5]
  }

  // Normalize to unit vector (cosine similarity expects normalized vectors)
  let norm = 0;
  for (let i = 0; i < 512; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 512; i++) {
    embedding[i] = embedding[i] / norm;
  }

  return embedding;
}

/**
 * Compute a quality score for an image (Laplacian variance for blur detection).
 *
 * Phase 1: Placeholder that returns a reasonable score.
 * Phase 2: Fetch image, apply Laplacian kernel, compute variance.
 *
 * Higher scores = sharper images. Threshold for baseline quality: ~100+
 */
async function computeQualityScore(_imageUrl: string): Promise<number> {
  // Placeholder: return a reasonable quality score
  // Real implementation would:
  // 1. Fetch the image
  // 2. Convert to grayscale
  // 3. Apply Laplacian kernel [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
  // 4. Compute variance of the result
  // 5. Higher variance = sharper image
  return 150 + Math.random() * 100; // 150-250 range (good quality)
}
