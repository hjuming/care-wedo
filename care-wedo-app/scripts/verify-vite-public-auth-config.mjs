const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missing = required.filter((name) => !String(process.env[name] || "").trim());

if (missing.length > 0) {
  console.error(`Missing frontend public auth config: ${missing.join(", ")}`);
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(process.env.VITE_SUPABASE_URL);
} catch {
  console.error("VITE_SUPABASE_URL must be a valid URL.");
  process.exit(1);
}

if (!/^https:$/.test(parsedUrl.protocol) || !parsedUrl.hostname.endsWith(".supabase.co")) {
  console.error("VITE_SUPABASE_URL must be an https Supabase project URL.");
  process.exit(1);
}

console.log("Frontend public auth config is ready for the Vite build.");
