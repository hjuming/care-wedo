interface Env {
  ASSETS: Fetcher;
}

// File extensions that should ALWAYS be served as static assets (never fallback to index.html)
const STATIC_EXT_RE = /\.(js|css|map|json|ico|svg|png|jpe?g|gif|webp|woff2?|ttf|eot|txt|xml|webmanifest)$/i;

/**
 * Catch-all SPA fallback handler.
 * 1. If the URL looks like a static asset (by extension), serve it directly.
 *    Return the original response even if it's 404 — let the browser handle missing assets
 *    rather than silently serving index.html, which would break JS module loading.
 * 2. For all other paths (SPA routes), try static first; if not found, serve index.html.
 * More-specific functions under functions/api/ take priority over this catch-all.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { pathname } = new URL(context.request.url);

  // Static asset request — always return the real response (even if 404).
  // This prevents the browser from receiving index.html when it expects JS/CSS,
  // which would cause "MIME type mismatch" errors and crash the SPA.
  if (STATIC_EXT_RE.test(pathname)) {
    return context.env.ASSETS.fetch(context.request.clone());
  }

  // SPA route — try static first, fallback to index.html
  const response = await context.env.ASSETS.fetch(context.request.clone());

  if (response.ok || response.redirected) {
    return response;
  }

  // Not a static asset → return index.html with 200 for SPA client-side routing
  return context.env.ASSETS.fetch(
    new Request(new URL("/index.html", context.request.url)),
  );
};
