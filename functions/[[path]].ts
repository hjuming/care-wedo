interface Env {
  ASSETS: Fetcher;
}

/**
 * Catch-all SPA fallback handler.
 * Tries to serve the requested static asset first.
 * If not found (404), serves /index.html so React Router handles the path.
 * More-specific functions under functions/api/ take priority over this catch-all.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.env.ASSETS.fetch(context.request.clone());

  if (response.ok || response.redirected) {
    return response;
  }

  // Not a static asset → return index.html with 200 for SPA client-side routing
  return context.env.ASSETS.fetch(
    new Request(new URL("/index.html", context.request.url)),
  );
};
