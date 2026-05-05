#!/usr/bin/env tsx
/**
 * Care WEDO — Phase 2.5 Backfill Scope
 *
 * Fills group_id / profile_id / created_by_user_id for existing appointments
 * and medications that were created before the group-based scope migration.
 *
 * Usage:
 *   npm run backfill:scope:dry    — report only, zero DB changes
 *   npm run backfill:scope:apply  — write auto-fillable records to Supabase
 *
 * Setup:
 *   cp .env.scripts.example .env.scripts
 *   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "node:fs";

// ─── Constants ───────────────────────────────────────────────────────────────

const LEGACY_DEMO_LINE_USER_IDS = new Set(["web-mvp"]);
const isDryRun = !process.argv.includes("--apply");

// ─── Env loader (reads .env.scripts if present) ──────────────────────────────

function loadEnv(): void {
  try {
    const content = readFileSync(".env.scripts", "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=\s][^=]*)=(.*)/);
      if (!match) continue;
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.scripts not found — rely on process.env
  }
}

// ─── Supabase REST client ─────────────────────────────────────────────────────

function createClient(url: string, serviceKey: string) {
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${base}/${path}`, { headers });
    if (!res.ok) {
      throw new Error(`GET /${path} → ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async function patch(
    table: string,
    id: number,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(`${base}/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      throw new Error(`PATCH ${table}#${id} → ${res.status}: ${await res.text()}`);
    }
  }

  return { get, patch };
}

// ─── Types ───────────────────────────────────────────────────────────────────

type UserRow = { id: number; line_user_id: string; name: string | null };
type MembershipRow = { user_id: number; group_id: number };
type ProfileRow = { id: number; group_id: number; is_default: boolean; display_name: string };

type RecordRow = {
  id: number;
  user_id: number;
  group_id: number | null;
  profile_id: number | null;
  created_by_user_id: number | null;
};

type Category = "already_scoped" | "auto_fillable" | "ambiguous" | "legacy_demo";

type Classified = {
  id: number;
  user_id: number;
  category: Category;
  fill?: { group_id: number; profile_id: number; created_by_user_id: number };
  reason?: string;
};

type TableResult = { total: number; auto_fillable: number; applied: number; errors: number };

// ─── Classification logic ─────────────────────────────────────────────────────

function buildClassifier(
  legacyUserIds: Set<number>,
  userGroupMap: Map<number, number[]>,
  groupProfileMap: Map<number, ProfileRow[]>,
) {
  return function classify(row: RecordRow): Classified {
    // 1. Already fully scoped → skip
    if (row.group_id !== null && row.profile_id !== null) {
      return { id: row.id, user_id: row.user_id, category: "already_scoped" };
    }

    // 2. Legacy demo user → skip, await Phase 4 cleanup
    if (legacyUserIds.has(row.user_id)) {
      return {
        id: row.id,
        user_id: row.user_id,
        category: "legacy_demo",
        reason: `user_id=${row.user_id} is legacy_demo (web-mvp)`,
      };
    }

    const groupIds = userGroupMap.get(row.user_id) ?? [];

    // 3. No group memberships
    if (groupIds.length === 0) {
      return {
        id: row.id,
        user_id: row.user_id,
        category: "ambiguous",
        reason: `user_id=${row.user_id} has no group memberships`,
      };
    }

    // 4. Multiple groups → cannot safely determine which group
    if (groupIds.length > 1) {
      return {
        id: row.id,
        user_id: row.user_id,
        category: "ambiguous",
        reason: `user_id=${row.user_id} belongs to ${groupIds.length} groups: [${groupIds.join(", ")}]`,
      };
    }

    const groupId = groupIds[0];
    const groupProfiles = groupProfileMap.get(groupId) ?? [];

    // 5. No profiles in the group
    if (groupProfiles.length === 0) {
      return {
        id: row.id,
        user_id: row.user_id,
        category: "ambiguous",
        reason: `group_id=${groupId} has no care profiles`,
      };
    }

    // 6. Multiple profiles → cannot safely determine which profile
    if (groupProfiles.length > 1) {
      const profileIds = groupProfiles.map((p) => p.id);
      return {
        id: row.id,
        user_id: row.user_id,
        category: "ambiguous",
        reason: `group_id=${groupId} has ${groupProfiles.length} profiles: [${profileIds.join(", ")}]`,
      };
    }

    // 7. Exactly 1 group, 1 profile → auto-fillable
    const profile = groupProfiles[0];
    return {
      id: row.id,
      user_id: row.user_id,
      category: "auto_fillable",
      fill: {
        group_id: groupId,
        profile_id: profile.id,
        // created_by_user_id: prefer existing value, fall back to user_id
        created_by_user_id: row.created_by_user_id ?? row.user_id,
      },
    };
  };
}

// ─── Process one table ────────────────────────────────────────────────────────

async function processTable(
  db: ReturnType<typeof createClient>,
  tableName: string,
  rows: RecordRow[],
  classify: (row: RecordRow) => Classified,
): Promise<TableResult> {
  const classified = rows.map(classify);
  const byCategory = (cat: Category) => classified.filter((r) => r.category === cat);

  const alreadyScoped = byCategory("already_scoped");
  const autoFillable = byCategory("auto_fillable");
  const ambiguous = byCategory("ambiguous");
  const legacyDemo = byCategory("legacy_demo");

  console.log(`${tableName}: ${rows.length} total`);
  console.log(`  ✅ already_scoped : ${alreadyScoped.length}`);
  console.log(`  🔧 auto_fillable  : ${autoFillable.length}`);
  console.log(`  ⚠️  ambiguous      : ${ambiguous.length}`);
  console.log(`  🏷️  legacy_demo    : ${legacyDemo.length}`);

  if (ambiguous.length > 0) {
    console.log(`\n  Ambiguous ${tableName} — manual review needed:`);
    for (const r of ambiguous) {
      console.log(`    id=${r.id}  user_id=${r.user_id}  reason: ${r.reason}`);
    }
  }

  if (legacyDemo.length > 0) {
    const ids = legacyDemo.map((r) => r.id).join(", ");
    console.log(`\n  Legacy demo ${tableName} (skip — Phase 4 cleanup): [${ids}]`);
  }

  let applied = 0;
  let errors = 0;

  if (autoFillable.length > 0) {
    console.log(`\n  Auto-fillable ${tableName}:`);
    for (const r of autoFillable) {
      const fill = r.fill!;
      const desc =
        `id=${r.id} → group_id=${fill.group_id}, profile_id=${fill.profile_id},` +
        ` created_by_user_id=${fill.created_by_user_id}`;

      if (isDryRun) {
        console.log(`    [DRY RUN] would update ${desc}`);
      } else {
        try {
          await db.patch(tableName, r.id, {
            group_id: fill.group_id,
            profile_id: fill.profile_id,
            created_by_user_id: fill.created_by_user_id,
          });
          console.log(`    ✅ updated ${desc}`);
          applied++;
        } catch (err) {
          console.error(`    ❌ failed ${desc}: ${err instanceof Error ? err.message : err}`);
          errors++;
        }
      }
    }
  }

  console.log();
  return { total: rows.length, auto_fillable: autoFillable.length, applied, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();

  const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.");
    console.error("    Create .env.scripts from .env.scripts.example and fill in the values.");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log("=".repeat(60));
  console.log("  Care WEDO — Phase 2.5 Backfill Scope");
  console.log(`  Mode: ${isDryRun ? "DRY RUN (no DB changes)" : "APPLY (writing to Supabase)"}`);
  console.log("=".repeat(60));
  console.log();

  // ── Load reference data ──────────────────────────────────────────────────
  const [users, memberships, profiles] = await Promise.all([
    db.get<UserRow[]>("users?select=id,line_user_id,name&limit=1000"),
    db.get<MembershipRow[]>("user_family_groups?select=user_id,group_id&limit=1000"),
    db.get<ProfileRow[]>("care_profiles?select=id,group_id,is_default,display_name&limit=1000"),
  ]);

  // Build lookup maps
  const legacyUserIds = new Set(
    users.filter((u) => LEGACY_DEMO_LINE_USER_IDS.has(u.line_user_id)).map((u) => u.id),
  );

  const userGroupMap = new Map<number, number[]>();
  for (const m of memberships) {
    const groups = userGroupMap.get(m.user_id) ?? [];
    groups.push(m.group_id);
    userGroupMap.set(m.user_id, groups);
  }

  const groupProfileMap = new Map<number, ProfileRow[]>();
  for (const p of profiles) {
    if (!p.group_id) continue;
    const arr = groupProfileMap.get(p.group_id) ?? [];
    arr.push(p);
    groupProfileMap.set(p.group_id, arr);
  }

  console.log(
    `Reference data: ${users.length} users (${legacyUserIds.size} legacy_demo),` +
      ` ${memberships.length} memberships, ${profiles.length} profiles\n`,
  );

  const classify = buildClassifier(legacyUserIds, userGroupMap, groupProfileMap);

  // ── Scan appointments ────────────────────────────────────────────────────
  const appointments = await db.get<RecordRow[]>(
    "appointments?select=id,user_id,group_id,profile_id,created_by_user_id&limit=5000",
  );
  const apptResult = await processTable(db, "appointments", appointments, classify);

  // ── Scan medications ─────────────────────────────────────────────────────
  const medications = await db.get<RecordRow[]>(
    "medications?select=id,user_id,group_id,profile_id,created_by_user_id&limit=5000",
  );
  const medResult = await processTable(db, "medications", medications, classify);

  // ── Scan care_documents ──────────────────────────────────────────────────
  // care_documents uses uploaded_by_user_id, not user_id — remap for classification
  type DocRow = { id: number; uploaded_by_user_id: number | null; group_id: number | null; profile_id: number | null };
  const rawDocs = await db.get<DocRow[]>(
    "care_documents?select=id,uploaded_by_user_id,group_id,profile_id&limit=5000",
  );
  const docsAsRecords: RecordRow[] = rawDocs.map((d) => ({
    id: d.id,
    user_id: d.uploaded_by_user_id ?? 0,
    group_id: d.group_id,
    profile_id: d.profile_id,
    created_by_user_id: d.uploaded_by_user_id,
  }));
  const docResult = await processTable(db, "care_documents", docsAsRecords, classify);

  // ── Final summary ────────────────────────────────────────────────────────
  const totalFillable = apptResult.auto_fillable + medResult.auto_fillable + docResult.auto_fillable;
  const totalApplied = apptResult.applied + medResult.applied + docResult.applied;
  const totalErrors = apptResult.errors + medResult.errors + docResult.errors;

  console.log("=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));
  console.log(`  appointments : ${apptResult.total} total, ${apptResult.auto_fillable} auto-fillable`);
  console.log(`  medications  : ${medResult.total} total, ${medResult.auto_fillable} auto-fillable`);
  console.log(`  care_documents: ${docResult.total} total, ${docResult.auto_fillable} auto-fillable`);
  console.log();

  if (isDryRun) {
    if (totalFillable === 0) {
      console.log("  ✅ No records need backfill.");
    } else {
      console.log(`  ${totalFillable} records can be auto-filled.`);
      console.log('  Run `npm run backfill:scope:apply` to apply changes.');
    }
  } else {
    console.log(`  ${totalApplied} records updated.`);
    if (totalErrors > 0) console.log(`  ❌ ${totalErrors} errors — check output above.`);
    if (totalApplied > 0) {
      console.log('  Run `npm run backfill:scope:dry` again to verify (auto_fillable should be 0).');
    }
  }

  console.log();
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
