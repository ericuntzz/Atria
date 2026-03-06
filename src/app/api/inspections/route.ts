import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";
import { users, properties, inspections } from "@/server/schema";
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

  if (!dbUser) {
    const [newUser] = await db
      .insert(users)
      .values({ supabaseId: user.id, email: user.email! })
      .returning();
    return newUser;
  }

  return dbUser;
}

// POST /api/inspections - Start a new inspection
export async function POST(request: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { propertyId } = body;

  if (!propertyId) {
    return NextResponse.json(
      { error: "propertyId is required" },
      { status: 400 },
    );
  }

  // Verify property belongs to user and is trained
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.userId, dbUser.id)));

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  if (property.trainingStatus !== "trained") {
    return NextResponse.json(
      { error: "Property must be trained before inspection" },
      { status: 400 },
    );
  }

  const [inspection] = await db
    .insert(inspections)
    .values({
      propertyId,
      inspectorId: dbUser.id,
      status: "in_progress",
    })
    .returning();

  return NextResponse.json(inspection, { status: 201 });
}

// GET /api/inspections - List inspections
export async function GET() {
  const dbUser = await getDbUser();
  if (!dbUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userInspections = await db
    .select()
    .from(inspections)
    .where(eq(inspections.inspectorId, dbUser.id))
    .orderBy(inspections.startedAt);

  return NextResponse.json(userInspections);
}
