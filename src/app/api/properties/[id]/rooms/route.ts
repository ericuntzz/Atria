import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { users, properties, rooms, items, baselineImages } from "@/server/schema";
import { eq, and } from "drizzle-orm";

async function getDbUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, user.id));

  return dbUser || null;
}

// GET /api/properties/[id]/rooms - List all rooms with items and baselines
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  // Get rooms with items and baseline images
  const propertyRooms = await db
    .select()
    .from(rooms)
    .where(eq(rooms.propertyId, id))
    .orderBy(rooms.sortOrder);

  const roomsWithDetails = await Promise.all(
    propertyRooms.map(async (room) => {
      const [roomItems, roomBaselines] = await Promise.all([
        db.select().from(items).where(eq(items.roomId, room.id)),
        db
          .select()
          .from(baselineImages)
          .where(eq(baselineImages.roomId, room.id)),
      ]);

      return {
        ...room,
        items: roomItems,
        baselineImages: roomBaselines,
      };
    }),
  );

  return NextResponse.json(roomsWithDetails);
}
