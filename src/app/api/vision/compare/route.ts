import { NextRequest, NextResponse } from "next/server";
import { getDbUser, isSafeUrl } from "@/lib/auth";
import { compareImages } from "@/lib/vision/compare";
import { emitMissionControlIncident } from "@/lib/mission-control";

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

    const { baseline_image_url, current_image_url, room_name } = body;

    if (!baseline_image_url || !current_image_url) {
      return NextResponse.json(
        { error: "baseline_image_url and current_image_url are required" },
        { status: 400 },
      );
    }

    if (typeof baseline_image_url !== "string" || typeof current_image_url !== "string") {
      return NextResponse.json(
        { error: "URLs must be strings" },
        { status: 400 },
      );
    }

    if (!isSafeUrl(baseline_image_url) || !isSafeUrl(current_image_url)) {
      return NextResponse.json(
        { error: "Invalid or unsafe image URL" },
        { status: 400 },
      );
    }

    const validatedRoomName = typeof room_name === "string" && room_name.trim()
      ? room_name.trim().slice(0, 200)
      : "the room";

    const result = await compareImages({
      baselineImage: baseline_image_url,
      currentImages: [current_image_url],
      roomName: validatedRoomName,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[vision/compare] POST error:", error);
    void emitMissionControlIncident({
      title: "Vision compare API error",
      description: error instanceof Error ? error.message : "Unknown error in /api/vision/compare",
      severity: "high",
      sourceId: "api:vision_compare",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
