import { NextRequest, NextResponse } from "next/server";
import { getDbUser, isValidUUID } from "@/lib/auth";
import { db } from "@/server/db";
import { properties, rooms, items, baselineImages } from "@/server/schema";
import { eq, and, inArray } from "drizzle-orm";

// GET /api/properties/[id]/rooms - List all rooms with items and baselines
export async function GET(
  _request: NextRequest,
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

    // Verify property belongs to user
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.userId, dbUser.id)));

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const propertyRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.propertyId, id))
      .orderBy(rooms.sortOrder);

    if (propertyRooms.length === 0) {
      return NextResponse.json([]);
    }

    // Batch-fetch all items and baselines for all rooms in 2 queries (fixes N+1)
    const roomIds = propertyRooms.map((r) => r.id);

    const [allItems, allBaselines] = await Promise.all([
      db.select().from(items).where(inArray(items.roomId, roomIds)),
      db.select().from(baselineImages).where(inArray(baselineImages.roomId, roomIds)),
    ]);

    // Group by roomId in memory
    const itemsByRoom = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const list = itemsByRoom.get(item.roomId) || [];
      list.push(item);
      itemsByRoom.set(item.roomId, list);
    }

    const baselinesByRoom = new Map<string, typeof allBaselines>();
    for (const bl of allBaselines) {
      const list = baselinesByRoom.get(bl.roomId) || [];
      list.push(bl);
      baselinesByRoom.set(bl.roomId, list);
    }

    const roomsWithDetails = propertyRooms.map((room) => ({
      ...room,
      items: itemsByRoom.get(room.id) || [],
      baselineImages: baselinesByRoom.get(room.id) || [],
    }));

    return NextResponse.json(roomsWithDetails);
  } catch (error) {
    console.error("[rooms] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
