import { supabase } from "./supabase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL;
if (!API_BASE) throw new Error("Missing EXPO_PUBLIC_API_URL env var");

/** Default request timeout (15 seconds) */
const REQUEST_TIMEOUT_MS = 15_000;

/** Max retries for transient failures (network errors, 5xx) */
const MAX_RETRIES = 2;

interface FetchOptions extends RequestInit {
  json?: Record<string, unknown>;
  /** Override default timeout (ms). Set to 0 for no timeout. */
  timeoutMs?: number;
  /** Disable automatic retry for this request */
  noRetry?: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Fetch with a timeout using AbortController.
 */
function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetch(url, options);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

/**
 * Authenticated fetch wrapper for the Next.js backend.
 * Includes request timeout, automatic retry on transient failures,
 * and 401 token refresh.
 */
async function authFetch(path: string, options: FetchOptions = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  const { json, timeoutMs = REQUEST_TIMEOUT_MS, noRetry, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
    ...(options.headers as Record<string, string>),
  };

  if (json) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(json);
  }

  const url = `${API_BASE}${path}`;
  const maxAttempts = noRetry ? 1 : MAX_RETRIES + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs);

      // On 401, try refreshing the token once and retry
      if (res.status === 401 && attempt === 1) {
        const { data: refreshData } = await supabase.auth.refreshSession();
        if (refreshData.session?.access_token) {
          headers.Authorization = `Bearer ${refreshData.session.access_token}`;
          continue; // Retry with new token
        }
        throw new ApiError(401, "Session expired. Please sign in again.");
      }

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        const apiError = new ApiError(res.status, error.error || "Request failed");

        // Retry on 5xx server errors (not on 4xx client errors)
        if (res.status >= 500 && attempt < maxAttempts) {
          await delay(attempt * 1000); // 1s, 2s backoff
          continue;
        }
        throw apiError;
      }

      return res;
    } catch (err) {
      // Retry on network/timeout errors
      if (err instanceof ApiError) throw err;
      if (attempt < maxAttempts) {
        await delay(attempt * 1000);
        continue;
      }
      if ((err as Error).name === "AbortError") {
        throw new ApiError(0, "Request timed out. Check your connection.");
      }
      throw new ApiError(0, "Network error. Check your connection.");
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw new ApiError(0, "Request failed after retries");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Properties
// ============================================================================

export async function getProperties() {
  const res = await authFetch("/api/properties");
  return res.json();
}

export async function getProperty(id: string) {
  const res = await authFetch(`/api/properties/${id}`);
  return res.json();
}

export async function updateProperty(
  id: string,
  updates: Record<string, unknown>,
) {
  const res = await authFetch(`/api/properties/${id}`, {
    method: "PATCH",
    json: updates,
  });
  return res.json();
}

export async function deleteProperty(id: string) {
  const res = await authFetch(`/api/properties/${id}`, {
    method: "DELETE",
  });
  return res.json();
}

// ============================================================================
// Inspections
// ============================================================================

export async function createInspection(propertyId: string, mode: string = "turnover") {
  const res = await authFetch("/api/inspections", {
    method: "POST",
    json: { propertyId, inspectionMode: mode },
  });
  return res.json();
}

export async function getInspection(id: string) {
  const res = await authFetch(`/api/inspections/${id}`);
  return res.json();
}

export async function getInspectionBaselines(inspectionId: string) {
  const res = await authFetch(`/api/inspections/${inspectionId}/baselines`);
  return res.json();
}

export async function submitBulkResults(
  inspectionId: string,
  results: unknown[],
  completionTier?: string,
  notes?: string,
) {
  const res = await authFetch(`/api/inspections/${inspectionId}/bulk`, {
    method: "POST",
    json: { results, completionTier, notes },
  });
  return res.json();
}

// ============================================================================
// Training
// ============================================================================

export async function trainProperty(propertyId: string, mediaUploadIds: string[]) {
  const res = await authFetch(`/api/properties/${propertyId}/train`, {
    method: "POST",
    json: { mediaUploadIds },
  });
  return res.json();
}

export async function getRooms(propertyId: string) {
  const res = await authFetch(`/api/properties/${propertyId}/rooms`);
  return res.json();
}

// ============================================================================
// Vision Comparison (SSE)
// ============================================================================

export interface CompareStreamOptions {
  baselineUrl: string;
  currentImages: string[];
  roomName: string;
  inspectionMode?: string;
  knownConditions?: string[];
  inspectionId?: string;
  roomId?: string;
  baselineImageId?: string;
}

/**
 * POST to the SSE compare-stream endpoint.
 * Returns the raw Response for SSE parsing by the comparison manager.
 */
export async function compareStream(options: CompareStreamOptions) {
  return authFetch("/api/vision/compare-stream", {
    method: "POST",
    json: options as unknown as Record<string, unknown>,
  });
}

// ============================================================================
// Upload
// ============================================================================

export async function uploadBase64Image(
  base64Image: string,
  propertyId: string,
  fileName?: string,
) {
  const res = await authFetch("/api/upload", {
    method: "POST",
    json: { base64Image, propertyId, fileName },
  });
  return res.json();
}
