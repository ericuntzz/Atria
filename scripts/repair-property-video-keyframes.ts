import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/server/db";
import { mediaUploads } from "@/server/schema";

const VIDEO_KEYFRAME_TIMESTAMPS_MS = [
  0,
  1200,
  3000,
  6000,
  10_000,
];

function createStorageAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin credentials are required");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function extractStoragePath(publicUrl: string): string {
  const marker = "/storage/v1/object/public/property-media/";
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    throw new Error(`Unable to derive storage path from URL: ${publicUrl}`);
  }
  return publicUrl.slice(index + marker.length);
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Downloaded empty file from ${url}`);
  }
  writeFileSync(filePath, buffer);
}

function extractFrame(videoPath: string, outputPath: string, timeMs: number): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      (timeMs / 1000).toFixed(3),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    { stdio: "ignore" },
  );
}

async function main() {
  const propertyId = process.argv[2];
  if (!propertyId) {
    throw new Error("Usage: npx tsx scripts/repair-property-video-keyframes.ts <property-id>");
  }

  const uploads = await db
    .select({
      id: mediaUploads.id,
      fileName: mediaUploads.fileName,
      fileType: mediaUploads.fileType,
      fileUrl: mediaUploads.fileUrl,
    })
    .from(mediaUploads)
    .where(eq(mediaUploads.propertyId, propertyId));

  const videos = uploads.filter((upload) => upload.fileType.startsWith("video/"));
  if (videos.length === 0) {
    throw new Error(`No video uploads found for property ${propertyId}`);
  }

  const storage = createStorageAdminClient();
  const tempDir = mkdtempSync(join(tmpdir(), "atria-keyframes-"));

  try {
    for (const video of videos) {
      const prefix = video.fileName.replace(/\.[^.]+$/, "");
      const frameRows = await db
        .select({
          id: mediaUploads.id,
          fileName: mediaUploads.fileName,
          fileUrl: mediaUploads.fileUrl,
        })
        .from(mediaUploads)
        .where(
          and(
            eq(mediaUploads.propertyId, propertyId),
            like(mediaUploads.fileName, `${prefix}-frame-%`),
          ),
        );

      if (frameRows.length === 0) continue;

      const videoPath = join(tempDir, video.fileName);
      console.info(`[keyframe-repair] Downloading ${video.fileName}`);
      await downloadToFile(video.fileUrl, videoPath);

      for (const frameRow of frameRows) {
        const match = frameRow.fileName.match(/-frame-(\d+)\.jpg$/);
        if (!match) continue;
        const frameNumber = Number.parseInt(match[1], 10);
        const timeMs = VIDEO_KEYFRAME_TIMESTAMPS_MS[frameNumber - 1];
        if (timeMs === undefined) continue;

        const outputPath = join(tempDir, frameRow.fileName);
        extractFrame(videoPath, outputPath, timeMs);
        const buffer = readFileSync(outputPath);
        if (buffer.length === 0) {
          throw new Error(`ffmpeg produced an empty frame for ${frameRow.fileName}`);
        }

        const storagePath = extractStoragePath(frameRow.fileUrl);
        const { error } = await storage.storage
          .from("property-media")
          .upload(storagePath, buffer, {
            contentType: "image/jpeg",
            upsert: true,
          });
        if (error) {
          throw new Error(
            `Failed to upload repaired frame ${frameRow.fileName}: ${error.message}`,
          );
        }

        console.info(`[keyframe-repair] Repaired ${frameRow.fileName}`);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[keyframe-repair] Failed:", error);
  process.exit(1);
});
