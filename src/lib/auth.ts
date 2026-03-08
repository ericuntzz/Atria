import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { db } from "@/server/db";
import { users } from "@/server/schema";
import { eq } from "drizzle-orm";

/**
 * Get the authenticated user's database record.
 * Supports two auth methods:
 * 1. Cookie-based (web dashboard via Supabase SSR)
 * 2. Bearer token (mobile app / API calls via Authorization header)
 * Auto-creates a user record on first login if one doesn't exist.
 */
export async function getDbUser() {
  let user = null;

  // Try cookie-based auth first (web dashboard)
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Cookie auth failed, will try Bearer token below
  }

  // Fall back to Bearer token auth (mobile app / API)
  if (!user) {
    try {
      const headerStore = await headers();
      const authorization = headerStore.get("authorization");
      if (authorization?.startsWith("Bearer ")) {
        const token = authorization.slice(7);
        const supabase = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data } = await supabase.auth.getUser(token);
        user = data.user;
      }
    } catch {
      // Bearer token auth failed
    }
  }

  if (!user) return null;

  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, user.id));

  if (dbUser) return dbUser;

  // Auto-create user record on first access (handle race condition with onConflictDoNothing)
  await db
    .insert(users)
    .values({
      supabaseId: user.id,
      email: user.email || `${user.id}@unknown`,
      firstName: user.user_metadata?.first_name || null,
      lastName: user.user_metadata?.last_name || null,
      profileImageUrl: user.user_metadata?.avatar_url || null,
    })
    .onConflictDoNothing({ target: users.supabaseId });

  // Re-fetch to get the record (whether we just created it or it already existed)
  const [newUser] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, user.id));

  return newUser;
}

/**
 * Validate that a string is a valid UUID v4 format.
 * Use this before passing user-supplied IDs to database queries
 * to prevent Postgres errors on invalid UUID format.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate that a URL is safe to fetch (SSRF protection).
 * Blocks: private IP ranges, localhost, link-local, metadata endpoints.
 * Only allows http/https protocols.
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // Only allow http/https protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
      return false;
    }

    // Block common metadata endpoints (cloud provider SSRF targets)
    if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
      return false;
    }

    // Block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 10) return false;                    // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false;      // 192.168.0.0/16
      if (a === 169 && b === 254) return false;      // 169.254.0.0/16 (link-local)
      if (a === 0) return false;                     // 0.0.0.0/8
    }

    return true;
  } catch {
    return false;
  }
}
