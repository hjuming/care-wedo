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

    if (!token) {
      return Response.json({ error: "請先登入" }, { status: 401, headers: corsHeaders });
    }

    try {
      const identity = await verifyLineIdToken(env, token);
      (context as any).data = { ...(context as any).data, identity };
    } catch (error) {
      const message = error instanceof Error ? error.message : "登入已失效，請重新登入。";
      return Response.json({ error: message }, { status: 401, headers: corsHeaders });
    }
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
