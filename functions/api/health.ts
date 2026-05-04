export const onRequestGet: PagesFunction = async () => {
  return Response.json({
    status: "ok",
    service: "Care WEDO",
    runtime: "cloudflare-pages-functions",
    version: "0.1.0",
  });
};
