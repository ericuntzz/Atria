import { NextRequest, NextResponse } from "next/server";
import { getDbUser, isValidUUID, isSafeUrl } from "@/lib/auth";
import { db } from "@/server/db";
import {
  properties,
  mediaUploads,
  rooms,
  items,
  baselineImages,
  baselineVersions,
} from "@/server/schema";
import { eq, and, inArray } from "drizzle-orm";
import { emitEventSafe } from "@/lib/events/emit";

// POST /api/properties/[id]/train - Analyze uploaded media with AI
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const dbUser = await getDbUser();
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify property ownership
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.userId, dbUser.id)));

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { mediaUploadIds } = body;

  if (
    !mediaUploadIds ||
    !Array.isArray(mediaUploadIds) ||
    mediaUploadIds.length === 0
  ) {
    return NextResponse.json(
      { error: "No media uploads provided" },
      { status: 400 },
    );
  }

  const MAX_UPLOAD_IDS = 100;
  if (mediaUploadIds.length > MAX_UPLOAD_IDS) {
    return NextResponse.json(
      { error: `Too many uploads. Maximum is ${MAX_UPLOAD_IDS}` },
      { status: 400 },
    );
  }

  // Validate mediaUploadIds are valid UUIDs
  for (const uploadId of mediaUploadIds) {
    if (typeof uploadId !== "string" || !isValidUUID(uploadId)) {
      return NextResponse.json(
        { error: `Invalid upload ID: ${uploadId}` },
        { status: 400 },
      );
    }
  }

  // Get uploaded media (verified to belong to this property)
  const uploads = await db
    .select()
    .from(mediaUploads)
    .where(
      and(
        inArray(mediaUploads.id, mediaUploadIds as string[]),
        eq(mediaUploads.propertyId, id),
      ),
    );

  if (uploads.length === 0) {
    return NextResponse.json(
      { error: "No valid uploads found" },
      { status: 400 },
    );
  }

  // Mark property as training
  await db
    .update(properties)
    .set({ trainingStatus: "training", updatedAt: new Date() })
    .where(eq(properties.id, id));

  try {
    const imageUrls = uploads
      .filter((u) => u.fileType.startsWith("image/"))
      .map((u) => u.fileUrl);

    if (imageUrls.length === 0) {
      throw new Error(
        "No image files found in uploads. Please upload at least one image.",
      );
    }

    // Analyze images with Claude Vision API directly
    const analysis = await analyzePropertyImages(imageUrls, property.name);

    // Create rooms and items from AI analysis
    const createdRooms = [];

    // Validate AI analysis structure
    const VALID_CONDITIONS = ["excellent", "good", "fair", "poor"];
    const VALID_IMPORTANCES = ["critical", "high", "normal", "low"];

    for (let i = 0; i < analysis.rooms.length; i++) {
      const roomData = analysis.rooms[i];

      // Validate room name from AI response
      const roomName = typeof roomData.name === "string" && roomData.name.trim()
        ? roomData.name.trim().slice(0, 200)
        : `Room ${i + 1}`;
      const roomDescription = typeof roomData.description === "string"
        ? roomData.description.slice(0, 500)
        : null;
      const roomType = typeof (roomData.room_type || roomData.roomType) === "string"
        ? (roomData.room_type || roomData.roomType).slice(0, 50)
        : null;

      // Create room
      const [newRoom] = await db
        .insert(rooms)
        .values({
          propertyId: id,
          name: roomName,
          description: roomDescription,
          roomType: roomType,
          sortOrder: i,
        })
        .returning();

      // Create items for this room
      const roomItems = [];
      if (roomData.items && Array.isArray(roomData.items)) {
        for (const itemData of roomData.items) {
          // Validate item name from AI response
          const itemName = typeof itemData.name === "string" && itemData.name.trim()
            ? itemData.name.trim().slice(0, 200)
            : "Unknown Item";
          const itemCondition = typeof itemData.condition === "string" && VALID_CONDITIONS.includes(itemData.condition)
            ? itemData.condition
            : "good";
          const itemImportance = typeof itemData.importance === "string" && VALID_IMPORTANCES.includes(itemData.importance)
            ? itemData.importance
            : "normal";

          const [newItem] = await db
            .insert(items)
            .values({
              roomId: newRoom.id,
              name: itemName,
              category: typeof itemData.category === "string" ? itemData.category.slice(0, 100) : null,
              description: typeof itemData.description === "string" ? itemData.description.slice(0, 500) : null,
              condition: itemCondition,
              importance: itemImportance,
            })
            .returning();
          roomItems.push({
            name: newItem.name,
            category: newItem.category || "",
          });
        }
      }

      // Assign baseline images to this room
      const roomImageUrls = roomData.image_urls || roomData.imageUrls || [];
      let baselineCount = 0;

      for (const imgUrl of roomImageUrls) {
        // Only insert valid string URLs from AI response
        if (typeof imgUrl !== "string" || !imgUrl.trim()) continue;
        await db.insert(baselineImages).values({
          roomId: newRoom.id,
          imageUrl: imgUrl,
          label: `Baseline ${baselineCount + 1}`,
          isActive: true,
        });
        baselineCount++;
      }

      // If no specific images assigned, distribute available images
      if (baselineCount === 0 && imageUrls.length > 0) {
        const startIdx = Math.floor(
          (i * imageUrls.length) / analysis.rooms.length,
        );
        const endIdx = Math.floor(
          ((i + 1) * imageUrls.length) / analysis.rooms.length,
        );
        for (let j = startIdx; j < endIdx && j < imageUrls.length; j++) {
          await db.insert(baselineImages).values({
            roomId: newRoom.id,
            imageUrl: imageUrls[j],
            label: `Baseline ${j - startIdx + 1}`,
            isActive: true,
          });
          baselineCount++;
        }
      }

      createdRooms.push({
        name: newRoom.name,
        roomType: newRoom.roomType || "unknown",
        items: roomItems,
        baselineCount,
      });
    }

    // Create baseline version v1
    const [baselineVersion] = await db
      .insert(baselineVersions)
      .values({
        propertyId: id,
        versionNumber: 1,
        label: "Initial Training",
        isActive: true,
      })
      .returning();

    // Link all baseline images to this version and generate embeddings
    // Batch-fetch all rooms + baselines for this property (fixes N+1)
    const allPropertyRooms = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.propertyId, id));

    const allRoomIds = allPropertyRooms.map((r) => r.id);
    const allPropertyBaselines = allRoomIds.length > 0
      ? await db
          .select({ id: baselineImages.id, imageUrl: baselineImages.imageUrl })
          .from(baselineImages)
          .where(inArray(baselineImages.roomId, allRoomIds))
      : [];

    const allBaselineIds: string[] = [];
    for (const bl of allPropertyBaselines) {
      allBaselineIds.push(bl.id);

      // Generate placeholder embedding + quality score
      const embedding = generatePlaceholderEmbedding(bl.imageUrl);
      const qualityScore = 150 + Math.random() * 100;

      await db
        .update(baselineImages)
        .set({
          baselineVersionId: baselineVersion.id,
          embedding,
          qualityScore,
          embeddingModelVersion: "mobileclip-s0-placeholder-v1",
        })
        .where(eq(baselineImages.id, bl.id));
    }

    // Set cover image and mark as trained
    await db
      .update(properties)
      .set({
        trainingStatus: "trained",
        trainingCompletedAt: new Date(),
        coverImageUrl: imageUrls[0] || null,
        updatedAt: new Date(),
      })
      .where(eq(properties.id, id));

    // Emit events
    await emitEventSafe({
      eventType: "BaselineVersionCreated",
      aggregateId: id,
      propertyId: id,
      userId: dbUser.id,
      payload: {
        versionId: baselineVersion.id,
        versionNumber: 1,
        label: "Initial Training",
        baselineCount: allBaselineIds.length,
        roomCount: createdRooms.length,
      },
    });

    await emitEventSafe({
      eventType: "PropertyCreated",
      aggregateId: id,
      propertyId: id,
      userId: dbUser.id,
      payload: {
        propertyName: property.name,
        roomCount: createdRooms.length,
        totalItems: createdRooms.reduce((sum, r) => sum + r.items.length, 0),
        baselineCount: allBaselineIds.length,
      },
    });

    const totalItems = createdRooms.reduce(
      (sum, r) => sum + r.items.length,
      0,
    );

    return NextResponse.json({
      rooms: createdRooms,
      totalRooms: createdRooms.length,
      totalItems,
      baselineVersion: {
        id: baselineVersion.id,
        versionNumber: 1,
        label: "Initial Training",
      },
    });
  } catch (err) {
    // Reset training status on error
    try {
      await db
        .update(properties)
        .set({ trainingStatus: "untrained", updatedAt: new Date() })
        .where(eq(properties.id, id));
    } catch (resetErr) {
      console.error("[train] Failed to reset training status:", resetErr);
    }

    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Training failed unexpectedly",
      },
      { status: 500 },
    );
  }
  } catch (error) {
    console.error("[train] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Analyze property images with Claude Vision API
async function analyzePropertyImages(
  imageUrls: string[],
  propertyName: string,
): Promise<{ rooms: any[] }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return generateBasicStructure(imageUrls);
  }

  try {
    const imagesToAnalyze = imageUrls.slice(0, 10);
    const imageContents = [];

    for (const url of imagesToAnalyze) {
      try {
        if (!isSafeUrl(url)) {
          console.warn("[train] Blocked unsafe URL:", url);
          continue;
        }
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!imgRes.ok) continue;
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const contentType =
          imgRes.headers.get("content-type") || "image/jpeg";

        imageContents.push({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: contentType.split(";")[0].trim(),
            data: base64,
          },
        });
      } catch {
        // Skip images that fail to fetch
      }
    }

    if (imageContents.length === 0) {
      return generateBasicStructure(imageUrls);
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(120000), // 2 minute timeout for AI analysis
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are analyzing photos of a luxury property called "${propertyName}". Identify each distinct room shown and all notable items/furniture/decor in each room.

Return ONLY valid JSON (no other text) with this structure:
{
  "rooms": [
    {
      "name": "Room Name (e.g. Master Bedroom, Kitchen)",
      "room_type": "bedroom|bathroom|kitchen|living|dining|outdoor|garage|office|hallway|other",
      "description": "Brief description of the room",
      "image_urls": ["urls of images showing this room"],
      "items": [
        {
          "name": "Item name (e.g. Leather Sofa, Crystal Chandelier)",
          "category": "furniture|decor|appliance|fixture|art|textile|storage|lighting|electronics",
          "description": "Brief description",
          "condition": "excellent|good|fair",
          "importance": "critical|high|normal|low"
        }
      ]
    }
  ]
}

Analyze all images and group them by room. Be thorough — identify every significant item visible. If multiple images show the same room from different angles, group them together.`,
              },
              ...imageContents,
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return generateBasicStructure(imageUrls);
    }

    const data = await res.json();
    const rawText = data.content?.[0]?.text;

    if (!rawText) {
      return generateBasicStructure(imageUrls);
    }

    try {
      return JSON.parse(rawText);
    } catch {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}") + 1;
      if (start !== -1 && end > start) {
        return JSON.parse(rawText.substring(start, end));
      }
      return generateBasicStructure(imageUrls);
    }
  } catch {
    return generateBasicStructure(imageUrls);
  }
}

/**
 * Generate a deterministic 512-dim placeholder embedding from an image URL.
 * Phase 2: Replace with actual MobileCLIP-S0 ONNX inference.
 */
function generatePlaceholderEmbedding(imageUrl: string): number[] {
  const embedding = new Array(512);
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) {
    const char = imageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  for (let i = 0; i < 512; i++) {
    hash = ((hash << 13) ^ hash) | 0;
    hash = (hash * 0x5bd1e995) | 0;
    hash = ((hash >> 15) ^ hash) | 0;
    embedding[i] = (hash & 0xffff) / 0xffff - 0.5;
  }
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

function generateBasicStructure(imageUrls: string[]): { rooms: any[] } {
  const rooms = imageUrls.map((url, i) => ({
    name: `Room ${i + 1}`,
    room_type: "other",
    description: "Auto-detected room (manual review recommended)",
    image_urls: [url],
    items: [],
  }));

  return { rooms };
}
