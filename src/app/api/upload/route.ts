import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { users, mediaUploads } from "@/server/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const propertyId = formData.get("propertyId") as string | null;

  if (!file || !propertyId) {
    return NextResponse.json(
      { error: "File and propertyId are required" },
      { status: 400 },
    );
  }

  // Upload to Supabase Storage
  const fileExt = file.name.split(".").pop();
  const fileName = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("property-media")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    // If bucket doesn't exist, try to create it
    if (uploadError.message.includes("not found") || uploadError.message.includes("Bucket")) {
      await supabase.storage.createBucket("property-media", {
        public: true,
      });
      // Retry upload
      const { data: retryData, error: retryError } = await supabase.storage
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
    } else {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 },
      );
    }
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
}
