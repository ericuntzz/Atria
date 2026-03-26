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
    if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
      return false;
    }

    // Block common metadata endpoints (cloud provider SSRF targets)
    if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
      return false;
    }

    // Block private and otherwise unsafe IPv4 ranges.
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if ([a, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
      if (a === 127) return false;                   // 127.0.0.0/8 (loopback)
      if (a === 10) return false;                    // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false;      // 192.168.0.0/16
      if (a === 169 && b === 254) return false;      // 169.254.0.0/16 (link-local)
      if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (CGNAT)
      if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 (benchmark)
      if (a >= 224) return false;                    // multicast / reserved
      if (a === 0) return false;                     // 0.0.0.0/8
    }

    // Block IPv6 private/reserved ranges
    const bare = hostname.replace(/^\[|\]$/g, ""); // strip brackets from [::1] form
    if (
      bare === "::" ||                                    // unspecified
      bare.startsWith("fc") || bare.startsWith("fd") ||   // Unique local (fc00::/7)
      /^fe[89ab]/i.test(bare) ||                           // Link-local (fe80::/10)
      bare.startsWith("ff") ||                             // Multicast (ff00::/8)
      /^fe[c-f]/i.test(bare) ||                            // Site-local / reserved fec0::/10
      bare.startsWith("::ffff:127.") ||                    // IPv4-mapped loopback
      bare.startsWith("::ffff:10.") ||                     // IPv4-mapped 10.x
      bare.startsWith("::ffff:192.168.") ||                // IPv4-mapped 192.168.x
      bare.startsWith("::ffff:169.254.") ||                // IPv4-mapped link-local
      /^::ffff:100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(bare) || // IPv4-mapped 100.64-127.x
      /^::ffff:198\.(18|19)\./.test(bare) ||               // IPv4-mapped 198.18-19.x
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(bare)      // IPv4-mapped 172.16-31.x
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
