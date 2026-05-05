#!/usr/bin/env tsx
/**
 * Care WEDO — Phase 4 Cleanup: legacy-demo / web-mvp test data
 *
 * Removes all data owned by the DEFAULT_USER ("web-mvp") and optionally
 * resets usage_quotas for a real LINE user.
 *
 * Usage:
 *   npm run cleanup:legacy:dry                                  — report only
 *   npm run cleanup:legacy:apply                                — execute cleanup
 *   npm run cleanup:legacy:dry   -- --reset-quota=<id_or_name>  — preview quota reset
 *   npm run cleanup:legacy:apply -- --reset-quota=<id_or_name>  — cleanup + reset quota
 *
 * Setup:
 *   cp .env.scripts.example .env.scripts
 *   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync } from "node:fs";

// ─── Constants ───────────────────────────────────────────────────────────────

const WEB_MVP_LINE_USER_ID = "web-mvp";

// ─── Env loader ───────────────────────────────────────────────────────────────

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
  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function get<T>(path: string): Promise<T[]> {
    const res = await fetch(`${base}/${path}`, { headers });
    if (!res.ok) {
      throw new Error(`GET /${path} → ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T[]>;
  }

  async function del(table: string, filter: string): Promise<void> {
    const res = await fetch(`${base}/${table}?${filter}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=minimal" },
    });
    if (!res.ok) {
      throw new Error(`DELETE ${table}?${filter} → ${res.status}: ${await res.text()}`);
    }
  }

  return { get, del };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRow = { id: number; line_user_id: string; name: string | null; created_at: string };
type MembershipRow = { user_id: number; group_id: number };
type GroupRow = { id: number; name: string | null };
type MemberWithUser = { user_id: number; group_id: number; users: { line_user_id: string; name: string | null } };
type IdRow = { id: number };

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "  Copy .env.scripts.example → .env.scripts and fill in the values.",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const isDryRun = !args.includes("--apply");
  const resetQuotaArg = args.find((a) => a.startsWith("--reset-quota="))?.split("=")[1];

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("\n=== Care WEDO Phase 4: Cleanup legacy-demo / web-mvp ===");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no changes)" : "APPLY (will delete)"}\n`);

  // ── 1. Find web-mvp user ────────────────────────────────────────────────────

  const users = await db.get<UserRow>(
    `users?line_user_id=eq.${WEB_MVP_LINE_USER_ID}&select=id,line_user_id,name,created_at`,
  );

  if (users.length === 0) {
    console.log("✓ No web-mvp user found — nothing to clean up.");
    if (resetQuotaArg) await handleQuotaReset(db, resetQuotaArg, isDryRun);
    return;
  }

  const webMvp = users[0];
  const webMvpId = webMvp.id;

  console.log("Found web-mvp user:");
  console.log(`  id:           ${webMvpId}`);
  console.log(`  line_user_id: ${webMvp.line_user_id}`);
  console.log(`  name:         ${webMvp.name ?? "(null)"}`);
  console.log(`  created_at:   ${webMvp.created_at}\n`);

  // ── 2. Count legacy records ─────────────────────────────────────────────────

  const [legacyApt, legacyMed, legacyDoc] = await Promise.all([
    db.get<IdRow>(
      `appointments?or=(user_id.eq.${webMvpId},created_by_user_id.eq.${webMvpId})&select=id`,
    ),
    db.get<IdRow>(
      `medications?or=(user_id.eq.${webMvpId},created_by_user_id.eq.${webMvpId})&select=id`,
    ),
    db.get<IdRow>(
      `care_documents?uploaded_by_user_id=eq.${webMvpId}&select=id`,
    ),
  ]);

  // ── 3. Classify groups ──────────────────────────────────────────────────────

  const memberships = await db.get<MembershipRow>(
    `user_family_groups?user_id=eq.${webMvpId}&select=group_id`,
  );
  const webMvpGroupIds = memberships.map((m) => m.group_id);

  // Count usage_quotas for web-mvp groups
  let legacyQuotas: IdRow[] = [];
  if (webMvpGroupIds.length > 0) {
    legacyQuotas = await db.get<IdRow>(
      `usage_quotas?group_id=in.(${webMvpGroupIds.join(",")})&select=id`,
    );
  }

  // Classify each group as demo-only vs. ambiguous (has real LINE members besides web-mvp)
  const demoOnlyGroupIds: number[] = [];
  type AmbiguousGroup = { id: number; name: string | null; realMemberCount: number };
  const ambiguousGroups: AmbiguousGroup[] = [];

  for (const groupId of webMvpGroupIds) {
    const allMembers = await db.get<MemberWithUser>(
      `user_family_groups?group_id=eq.${groupId}&select=user_id,group_id,users(line_user_id,name)`,
    );
    const realMembers = allMembers.filter(
      (m) => m.users?.line_user_id !== WEB_MVP_LINE_USER_ID,
    );

    if (realMembers.length === 0) {
      demoOnlyGroupIds.push(groupId);
    } else {
      const groups = await db.get<GroupRow>(`family_groups?id=eq.${groupId}&select=id,name`);
      ambiguousGroups.push({
        id: groupId,
        name: groups[0]?.name ?? null,
        realMemberCount: realMembers.length,
      });
    }
  }

  // Count care_profiles in demo-only groups (for reporting)
  let demoOnlyProfiles: IdRow[] = [];
  if (demoOnlyGroupIds.length > 0) {
    demoOnlyProfiles = await db.get<IdRow>(
      `care_profiles?group_id=in.(${demoOnlyGroupIds.join(",")})&select=id`,
    );
  }

  // ── 4. Print report ─────────────────────────────────────────────────────────

  console.log("─── Legacy data to be deleted ───────────────────────────");
  console.log(`  appointments:       ${legacyApt.length}`);
  console.log(`  medications:        ${legacyMed.length}`);
  console.log(`  care_documents:     ${legacyDoc.length}`);
  console.log(`  usage_quotas:       ${legacyQuotas.length}`);
  console.log(`  demo-only groups:   ${demoOnlyGroupIds.length} → will delete`);
  console.log(
    `  demo-only profiles: ${demoOnlyProfiles.length} → will delete (inside demo groups)`,
  );
  console.log(`  ambiguous groups:   ${ambiguousGroups.length} → will NOT delete`);

  if (ambiguousGroups.length > 0) {
    console.log("\n  ⚠ Ambiguous groups (have real LINE users — skipped):");
    for (const g of ambiguousGroups) {
      console.log(
        `    group_id=${g.id} "${g.name ?? "unnamed"}" — ${g.realMemberCount} real member(s)`,
      );
    }
  }

  if (isDryRun) {
    console.log("\n✓ Dry run complete. No data was modified.");
    console.log("  Re-run with --apply to execute cleanup.");
    if (resetQuotaArg) await handleQuotaReset(db, resetQuotaArg, true);
    return;
  }

  // ── 5. Apply cleanup ────────────────────────────────────────────────────────

  console.log("\n─── Applying cleanup ────────────────────────────────────");

  // 5a. Delete appointments owned by web-mvp
  await db.del(
    "appointments",
    `or=(user_id.eq.${webMvpId},created_by_user_id.eq.${webMvpId})`,
  );
  console.log(`  ✓ Deleted ${legacyApt.length} appointments`);

  // 5b. Delete medications owned by web-mvp
  await db.del(
    "medications",
    `or=(user_id.eq.${webMvpId},created_by_user_id.eq.${webMvpId})`,
  );
  console.log(`  ✓ Deleted ${legacyMed.length} medications`);

  // 5c. Delete care_documents uploaded by web-mvp
  await db.del("care_documents", `uploaded_by_user_id=eq.${webMvpId}`);
  console.log(`  ✓ Deleted ${legacyDoc.length} care_documents`);

  // 5d. Delete usage_quotas for all web-mvp groups
  if (webMvpGroupIds.length > 0) {
    await db.del("usage_quotas", `group_id=in.(${webMvpGroupIds.join(",")})`);
    console.log(`  ✓ Deleted ${legacyQuotas.length} usage_quotas`);
  }

  // 5e. Delete demo-only groups (cascade deletes care_profiles and memberships via FK)
  if (demoOnlyGroupIds.length > 0) {
    // care_profiles has FK → family_groups ON DELETE CASCADE, so deleting group cascades.
    // user_family_groups also cascades. Delete group directly.
    await db.del("family_groups", `id=in.(${demoOnlyGroupIds.join(",")})`);
    console.log(
      `  ✓ Deleted ${demoOnlyGroupIds.length} demo-only family_groups ` +
        `(cascade: ${demoOnlyProfiles.length} profiles + memberships)`,
    );
  }

  // 5f. Remove web-mvp memberships in ambiguous groups (clean the member row, keep the group)
  if (ambiguousGroups.length > 0) {
    await db.del("user_family_groups", `user_id=eq.${webMvpId}`);
    console.log(
      `  ✓ Removed web-mvp from ${ambiguousGroups.length} ambiguous group(s) (groups preserved)`,
    );
  }

  // 5g. Delete web-mvp user row itself
  await db.del("users", `id=eq.${webMvpId}`);
  console.log(`  ✓ Deleted web-mvp user row (id=${webMvpId})`);

  console.log("\n✓ Cleanup complete.\n");

  // ── 6. Optional quota reset ─────────────────────────────────────────────────

  if (resetQuotaArg) await handleQuotaReset(db, resetQuotaArg, false);
}

// ─── Quota reset helper ───────────────────────────────────────────────────────

async function handleQuotaReset(
  db: ReturnType<typeof createClient>,
  userIdentifier: string,
  dryRun: boolean,
): Promise<void> {
  console.log(`\n─── Quota reset for: "${userIdentifier}" ──────────────────`);

  // Look up by line_user_id first, then by name
  let user: UserRow | null = null;
  const byId = await db.get<UserRow>(
    `users?line_user_id=eq.${encodeURIComponent(userIdentifier)}&select=id,line_user_id,name,created_at&limit=1`,
  );
  if (byId.length > 0) {
    user = byId[0];
  } else {
    const byName = await db.get<UserRow>(
      `users?name=ilike.*${encodeURIComponent(userIdentifier)}*&select=id,line_user_id,name,created_at&limit=1`,
    );
    if (byName.length > 0) user = byName[0];
  }

  if (!user) {
    console.log(`  ⚠ No user found for "${userIdentifier}". Skipping quota reset.`);
    return;
  }

  console.log(`  User: id=${user.id}  name="${user.name}"  line_user_id="${user.line_user_id}"`);

  const memberships = await db.get<MembershipRow>(
    `user_family_groups?user_id=eq.${user.id}&select=group_id`,
  );
  const groupIds = memberships.map((m) => m.group_id);

  if (groupIds.length === 0) {
    console.log("  No group memberships found. Nothing to reset.");
    return;
  }

  const quotas = await db.get<IdRow>(
    `usage_quotas?group_id=in.(${groupIds.join(",")})&select=id`,
  );

  console.log(
    `  Will reset ${quotas.length} usage_quota row(s) across ${groupIds.length} group(s)`,
  );
  console.log(`  Groups: [${groupIds.join(", ")}]`);

  if (dryRun) {
    console.log("  (dry run — no changes made)");
    return;
  }

  if (quotas.length > 0) {
    await db.del("usage_quotas", `group_id=in.(${groupIds.join(",")})`);
  }
  console.log(`  ✓ Reset ${quotas.length} quota row(s) for "${user.name}"`);
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n✗ Fatal error: ${msg}`);
  process.exit(1);
});
