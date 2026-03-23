import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function parseConfiguredCorsOrigins(): Set<string> {
  const raw = process.env.CORS_ALLOWED_ORIGIN || "";
  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => normalizeOrigin(origin)),
  );
}

function resolveCorsOrigin(request: NextRequest): string | null {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) return null;

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  const sameOrigin = normalizeOrigin(request.nextUrl.origin);
  if (normalizedRequestOrigin === sameOrigin) {
    return normalizedRequestOrigin;
  }

  const configuredOrigins = parseConfiguredCorsOrigins();
  if (configuredOrigins.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return null;
}

function applyCorsHeaders(response: NextResponse, allowedOrigin: string | null) {
  if (!allowedOrigin) return response;

  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  response.headers.set("Vary", "Origin");

  return response;
}

export async function middleware(request: NextRequest) {
  const allowedOrigin = resolveCorsOrigin(request);

  // Handle CORS preflight for API routes (required for mobile app Bearer token auth)
  if (
    request.method === "OPTIONS" &&
    request.nextUrl.pathname.startsWith("/api/")
  ) {
    if (request.headers.get("origin") && !allowedOrigin) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403 },
      );
    }

    return new NextResponse(null, {
      status: 204,
      headers: allowedOrigin
        ? {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Requested-With",
            "Access-Control-Max-Age": "86400",
            Vary: "Origin",
          }
        : {
            "Access-Control-Max-Age": "86400",
          },
    });
  }

  let response: NextResponse;
  try {
    response = await updateSession(request);
  } catch (err) {
    console.error("[middleware] updateSession failed:", err);
    response = NextResponse.next({ request });
  }

  // Add CORS headers to API responses (mobile app needs these in all environments)
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response = applyCorsHeaders(response, allowedOrigin);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
