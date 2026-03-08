import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/auth";

export async function GET() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(dbUser);
  } catch (error) {
    console.error("[users/me] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
