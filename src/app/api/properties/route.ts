import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/../server/db";
import { users, properties } from "@/../server/schema";
import { eq } from "drizzle-orm";

async function getDbUser(supabaseId: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, supabaseId))
    .limit(1);
  return existing ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbUser = await getDbUser(user.id);
    if (!dbUser) {
      return NextResponse.json([]);
    }

    const rows = await db
      .select()
      .from(properties)
      .where(eq(properties.userId, dbUser.id))
      .orderBy(properties.createdAt);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET /api/properties error:", error);
    return NextResponse.json(
      { error: "Failed to fetch properties" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let dbUser = await getDbUser(user.id);

    if (!dbUser) {
      const [created] = await db
        .insert(users)
        .values({
          supabaseId: user.id,
          email: user.email ?? "",
        })
        .returning();
      dbUser = created;
    }

    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "Property name is required" },
        { status: 400 },
      );
    }

    const [property] = await db
      .insert(properties)
      .values({
        userId: dbUser.id,
        name: body.name.trim(),
        address: body.address ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zipCode: body.zipCode ?? null,
        propertyType: body.propertyType ?? null,
        bedrooms: body.bedrooms ?? null,
        bathrooms: body.bathrooms ?? null,
        squareFeet: body.squareFeet ?? null,
        notes: body.notes ?? null,
      })
      .returning();

    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    console.error("POST /api/properties error:", error);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 },
    );
  }
}
