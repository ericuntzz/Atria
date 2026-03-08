import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDbUser, isValidUUID } from "@/lib/auth";
import { db } from "@/server/db";
import { properties, mediaUploads } from "@/server/schema";
import { eq, and } from "drizzle-orm";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
  const dbUser = await getDbUser();
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";

  // Route to base64 handler for JSON bodies
  if (contentType.includes("application/json")) {
    return handleBase64Upload(request, dbUser.id);
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formData = await request.formData() as any;
  const file = formData.get("file") as File | null;
  const propertyId = formData.get("propertyId") as string | null;

  if (!file || !propertyId) {
    return NextResponse.json(
      { error: "File and propertyId are required" },
      { status: 400 },
    );
  }

  if (!isValidUUID(propertyId)) {
    return NextResponse.json(
      { error: "Invalid propertyId format" },
      { status: 400 },
    );
  }

  // Verify property ownership
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.userId, dbUser.id)));

  if (!property) {
    return NextResponse.json(
      { error: "Property not found" },
      { status: 404 },
    );
  }

  // Validate file type
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPG, PNG, WebP, GIF, MP4, or MOV." },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 50MB." },
      { status: 400 },
    );
  }

  // Upload to Supabase Storage
  const fileExt = file.name.split(".").pop();
  const fileName = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let uploadSuccess = false;

  const { error: uploadError } = await supabase.storage
    .from("property-media")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[upload] Storage error:", uploadError.message);
    if (
      uploadError.message.includes("not found") ||
      uploadError.message.includes("Bucket")
    ) {
      await supabase.storage.createBucket("property-media", {
        public: true,
      });
      const { error: retryError } = await supabase.storage
        .from("property-media")
        .upload(fileName, buffer, {
          contentType: file.type,
          upsert: false,
        });
      if (retryError) {
        return NextResponse.json(
          { error: `Upload failed: ${retryError.message}` },
          { status: 500 },
        );
      }
      uploadSuccess = true;
    } else {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }
  } else {
    uploadSuccess = true;
  }

  if (!uploadSuccess) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from("property-media").getPublicUrl(fileName);

  // Store record in DB
  const [record] = await db
    .insert(mediaUploads)
    .values({
      propertyId,
      fileUrl: publicUrl,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })
    .returning();

  return NextResponse.json({
    id: record.id,
    fileUrl: publicUrl,
    fileName: file.name,
    fileType: file.type,
  });
  } catch (error) {
    console.error("[upload] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

const MAX_BASE64_SIZE = 50 * 1024 * 1024; // 50MB decoded

async function handleBase64Upload(request: NextRequest, userId: string) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { base64Image, propertyId, fileName } = body;

  if (!base64Image || !propertyId) {
    return NextResponse.json(
      { error: "base64Image and propertyId are required" },
      { status: 400 },
    );
  }

  if (typeof base64Image !== "string") {
    return NextResponse.json(
      { error: "base64Image must be a string" },
      { status: 400 },
    );
  }

  if (typeof propertyId !== "string" || !isValidUUID(propertyId)) {
    return NextResponse.json(
      { error: "Invalid propertyId format" },
      { status: 400 },
    );
  }

  // Verify property ownership
  const [property] = await db
    .select()
    .from(properties)
    .where(
      and(eq(properties.id, propertyId as string), eq(properties.userId, userId)),
    );

  if (!property) {
    return NextResponse.json(
      { error: "Property not found" },
      { status: 404 },
    );
  }

  // Parse base64 — supports both raw and data URI formats
  let base64Data = base64Image as string;
  let mimeType = "image/jpeg";

  const dataUriMatch = base64Data.match(
    /^data:((?:image|video)\/[\w.+-]+);base64,(.+)$/,
  );
  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    base64Data = dataUriMatch[2];
  }

  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported image type" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_BASE64_SIZE) {
    return NextResponse.json(
      { error: "Image too large. Maximum size is 50MB." },
      { status: 400 },
    );
  }

  // Determine file extension from mime type
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const ext = extMap[mimeType] || "jpg";
  const generatedName =
    (fileName as string) ||
    `capture-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const storagePath = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const supabase = await createClient();

  const { error: uploadError } = await supabase.storage
    .from("property-media")
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    // Try creating bucket if it doesn't exist
    if (
      uploadError.message.includes("not found") ||
      uploadError.message.includes("Bucket")
    ) {
      await supabase.storage.createBucket("property-media", { public: true });
      const { error: retryError } = await supabase.storage
        .from("property-media")
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: false,
        });
      if (retryError) {
        return NextResponse.json(
          { error: `Upload failed: ${retryError.message}` },
          { status: 500 },
        );
      }
    } else {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("property-media").getPublicUrl(storagePath);

  const [record] = await db
    .insert(mediaUploads)
    .values({
      propertyId: propertyId as string,
      fileUrl: publicUrl,
      fileName: generatedName,
      fileType: mimeType,
      fileSize: buffer.length,
    })
    .returning();

  return NextResponse.json({
    id: record.id,
    fileUrl: publicUrl,
    fileName: generatedName,
    fileType: mimeType,
  });
}
