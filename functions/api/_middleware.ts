import { getBearerToken, verifyLineIdToken, Env } from "../_shared/supabase";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

/**
 * Paths that do NOT require JWT authentication.
 * - /api/health: public health check
 * - /api/cron/*: protected by CRON_SECRET instead
 * - /api/dashboard GET: returns demo data when unauthenticated
 */
function isPublicPath(pathname: string, method: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/api/cron/")) return true;
  // Dashboard GET is allowed without auth (returns demo mode)
  if (pathname === "/api/dashboard" && method === "GET") return true;
  return false;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, next, env } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  // JWT verification for protected endpoints
  if (!isPublicPath(url.pathname, request.method)) {
    const token = getBearerToken(request);

    if (token) {
      // Validate the token — if invalid, still let the request through
      // since individual handlers may gracefully degrade to demo mode.
      // But store the verification result for downstream use.
      try {
        const identity = await verifyLineIdToken(env, token);
        // Attach identity to request context (Cloudflare Pages Functions pattern)
        (context as any).data = { ...(context as any).data, identity };
      } catch {
        // Token is present but invalid — let the handler decide how to respond.
        // Most handlers already call verifyLineIdToken themselves.
      }
    }
    // Note: We don't block requests without tokens here because many handlers
    // (dashboard, ocr) support both authenticated and unauthenticated modes.
    // The DELETE /api/me handler explicitly checks for token presence.
  }

  const response = await next();
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
