import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestGet as getDashboard } from "../api/dashboard";
import { onRequestGet as listDocuments } from "../api/documents";
import { onRequestDelete as deleteDocument, onRequestGet as getDocument, onRequestPatch as patchDocument } from "../api/documents/[id]";
import { onRequestGet as getDocumentFileUrl } from "../api/documents/[id]/file-url";
import { onRequestPost as createAppointment } from "../api/appointments";
import { onRequestPatch as patchAppointment } from "../api/appointments/[id]";
import { onRequestPatch as patchMedication } from "../api/medications/[id]";
import { onRequestPost as markMedicationsTaken } from "../api/medications/taken";
import { onRequestPatch as patchProfile } from "../api/profiles/[id]";
import { onRequestDelete as deleteMe } from "../api/me";
import { onRequestPatch as orderProfiles } from "../api/profiles/order";
import { onRequestPost as mutateGroups } from "../api/groups";
import { onRequestPost as uploadDocument } from "../api/documents/upload";
import { onRequestPost as confirmOcr } from "../api/ocr/confirm";
import { onRequestPost as runOcr } from "../api/ocr/[[path]]";
import { buildStoragePath } from "../_shared/care_documents";

/**
 * Behavioral tenant-isolation regression (drives the REAL handler).
 *
 * Unlike source-grep regressions, these tests invoke real Pages handlers end to
 * end with a mocked network layer (LINE verify + Supabase REST). They prove
 * app-layer ownership filters still stop cross-tenant writes while Supabase REST
 * is called with a service role key.
 *
 * If a future change drops an ownership filter or the unified auth path, the
 * cross-tenant case would start returning success or emit a PATCH and fail here.
 */

const ENV = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LINE_LOGIN_CHANNEL_ID: "1234567890",
} as any;

const ATTACKER_LINE_ID = "Uattacker";
const ATTACKER_USER_ID = 1;
const ATTACKER_GROUP_ID = 100; // the only group the attacker belongs to
const NOW = "2026-06-20T00:00:00.000Z";

type FetchHandler = (url: string, init: RequestInit | undefined) => Response;

function withMockedFetch(handler: FetchHandler, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Shared mock: LINE verify + user lookup + memberships are always the attacker. */
function baseRoutes(url: string): Response | null {
  if (url.includes("api.line.me/oauth2/v2.1/verify")) {
    return json({ sub: ATTACKER_LINE_ID, name: "Attacker" });
  }
  if (url.includes("/rest/v1/users?line_user_id=")) {
    return json([{ id: ATTACKER_USER_ID, name: "Attacker", picture_url: null }]);
  }
  if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
    return json([{ id: 10, user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "admin", can_manage: true }]);
  }
  if (
    url.includes(`/rest/v1/user_feature_flags?user_id=eq.${ATTACKER_USER_ID}`)
    && url.includes("feature_key=like.profile_order:")
  ) {
    return json([]);
  }
  return null;
}

function makePatchRequest(resource: string, id: number, body: Record<string, unknown>): Request {
  return new Request(`https://care.example/api/${resource}/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer line-attacker-id-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(path: string): Request {
  return new Request(`https://care.example${path}`, {
    method: "GET",
    headers: {
      Authorization: "Bearer line-attacker-id-token",
    },
  });
}

function makePostRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://care.example${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer line-attacker-id-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(path: string): Request {
  return new Request(`https://care.example${path}`, {
    method: "DELETE",
    headers: {
      Authorization: "Bearer line-attacker-id-token",
    },
  });
}

function groupRow(id = ATTACKER_GROUP_ID) {
  return {
    id,
    name: `Group ${id}`,
    invite_code: `G${id}`,
    owner_user_id: ATTACKER_USER_ID,
    plan_id: "pro",
    created_at: NOW,
  };
}

function planRow() {
  return {
    id: "pro",
    name: "Care Circle",
    monthly_ocr_limit: 100,
    max_members: 6,
    max_recipients: 4,
    family_group_enabled: true,
    price_monthly_usd: 0,
    is_active: true,
    sort_order: 10,
  };
}

function careProfileRow(id: number, groupId = ATTACKER_GROUP_ID) {
  return {
    id,
    group_id: groupId,
    primary_user_id: ATTACKER_USER_ID,
    display_name: `Profile ${id}`,
    relationship: "family",
    avatar_url: null,
    birth_year: null,
    birth_date: null,
    emergency_phone: null,
    email: null,
    main_hospital: null,
    main_department: null,
    notes: null,
    is_default: id === 501,
    sort_order: 10,
    created_at: NOW,
  };
}

function appointmentRow(id: number, groupId = ATTACKER_GROUP_ID) {
  return {
    id,
    user_id: ATTACKER_USER_ID,
    group_id: groupId,
    profile_id: 501,
    type: "clinic_visit",
    date: "2026-06-21",
    time: "09:00",
    title: "回診",
    hospital: "台北測試醫院",
    department: "家醫科",
    doctor: null,
    number: null,
    location: null,
    fasting_required: false,
    fasting_hours: null,
    notes: null,
    reminder_text: null,
    status: "upcoming",
    created_at: NOW,
  };
}

function medicationRow(id: number, groupId = ATTACKER_GROUP_ID) {
  return {
    id,
    user_id: ATTACKER_USER_ID,
    group_id: groupId,
    profile_id: 501,
    name: "測試用藥",
    dosage: "1 顆",
    frequency: "每日一次",
    time_slot: "morning",
    meal_timing: "after_meal",
    scheduled_time: "08:00",
    taken_status: null,
    purpose: null,
    warnings: null,
    reminder_text: null,
    active: false,
  };
}

function documentRow(id: number, groupId = ATTACKER_GROUP_ID) {
  return {
    id,
    group_id: groupId,
    profile_id: 501,
    uploaded_by_user_id: ATTACKER_USER_ID,
    document_type: "lab_report",
    source_file_url: null,
    storage_bucket: null,
    storage_path: null,
    original_file_name: "report.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 1024,
    page_count: 1,
    document_title: "檢驗報告",
    source_hospital: "台北測試醫院",
    document_date: "2026-06-20",
    summary_status: "confirmed",
    preserve_original_file: true,
    ocr_text: null,
    ai_summary: null,
    status: "confirmed",
    captured_at: null,
    deleted_at: null,
    created_at: NOW,
  };
}

test("rejects PATCH on a medication owned by another tenant's group (403)", async () => {
  const VICTIM_MED_ID = 999; // belongs to group 200, which attacker is NOT in
  let patchAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    // Ownership check: PostgREST or-filter is scoped to the attacker's
    // user_id / group_ids, so a victim-owned row matches nothing.
    if (url.includes(`/rest/v1/medications?id=eq.${VICTIM_MED_ID}`) && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([]); // not owned -> patchMedication throws -> 403
    }
    // Any actual PATCH write must never be reached for a foreign record.
    if (url.includes(`/rest/v1/medications?id=eq.${VICTIM_MED_ID}`) && init?.method === "PATCH") {
      patchAttempted = true;
      return json([{ id: VICTIM_MED_ID }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchMedication({
      request: makePatchRequest("medications", VICTIM_MED_ID, { active: false }),
      env: ENV,
      params: { id: String(VICTIM_MED_ID) },
    } as any);

    assert.equal(res.status, 403, "cross-tenant PATCH must be forbidden");
    assert.equal(patchAttempted, false, "must not issue a write for a foreign record");
  });
});

test("allows PATCH on a medication the user's group owns (200)", async () => {
  const OWNED_MED_ID = 888; // belongs to attacker's own group 100
  let patched = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/medications?id=eq.${OWNED_MED_ID}`) && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([{ id: OWNED_MED_ID }]); // owned
    }
    if (url.includes(`/rest/v1/medications?id=eq.${OWNED_MED_ID}`) && init?.method === "PATCH") {
      patched = true;
      return json([medicationRow(OWNED_MED_ID)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchMedication({
      request: makePatchRequest("medications", OWNED_MED_ID, { active: false }),
      env: ENV,
      params: { id: String(OWNED_MED_ID) },
    } as any);

    assert.equal(res.status, 200, "owner PATCH must succeed");
    assert.equal(patched, true, "owner PATCH must reach the write");
  });
});

test("rejects medication and appointment PATCH for a read-only family member", async () => {
  let writeAttempted = false;
  await withMockedFetch((url, init) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
      return json([{ user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "member", can_manage: false }]);
    }
    const base = baseRoutes(url);
    if (base) return base;
    if (init?.method === "PATCH") writeAttempted = true;
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const medicationResponse = await patchMedication({
      request: makePatchRequest("medications", 888, { active: false }),
      env: ENV,
      params: { id: "888" },
    } as any);
    const appointmentResponse = await patchAppointment({
      request: makePatchRequest("appointments", 887, { title: "不應寫入" }),
      env: ENV,
      params: { id: "887" },
    } as any);
    assert.equal(medicationResponse.status, 403);
    assert.equal(appointmentResponse.status, 403);
    assert.equal(writeAttempted, false);
  });
});

test("read-only family member cannot delete shared care data through account deletion", async () => {
  let sharedDeleteAttempted = false;
  await withMockedFetch((url, init) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
      return json([{ user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "member", can_manage: false }]);
    }
    const base = baseRoutes(url);
    if (base) return base;
    if (init?.method === "DELETE") {
      if (/appointments|medications|care_profiles|family_groups\?id=/.test(url)) sharedDeleteAttempted = true;
      return json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await deleteMe({
      request: makeDeleteRequest("/api/me"),
      env: ENV,
      params: {},
    } as any);
    assert.equal(response.status, 200);
    assert.equal(sharedDeleteAttempted, false, "read-only account deletion must retain shared family data");
  });
});

for (const accountCase of [
  { name: "without current memberships", memberships: [] },
  { name: "with an admin membership", memberships: [{ user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "admin", can_manage: true }] },
]) {
  test(`account deletion ${accountCase.name} never deletes family-shared care data`, async () => {
    const deleteUrls: string[] = [];
    await withMockedFetch((url, init) => {
      if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`) && init?.method !== "DELETE") {
        return json(accountCase.memberships);
      }
      const base = baseRoutes(url);
      if (base) return base;
      if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`) && init?.method === "DELETE") {
        deleteUrls.push(url);
        return json([]);
      }
      if (url.includes(`/rest/v1/users?id=eq.${ATTACKER_USER_ID}`) && init?.method === "DELETE") {
        deleteUrls.push(url);
        return json([]);
      }
      if (url.includes(`/rest/v1/user_family_groups?group_id=eq.${ATTACKER_GROUP_ID}`)) {
        return json([{ user_id: ATTACKER_USER_ID, role: "admin" }]);
      }
      if (init?.method === "DELETE") {
        deleteUrls.push(url);
        return json([]);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }, async () => {
      const response = await deleteMe({ request: makeDeleteRequest("/api/me"), env: ENV, params: {} } as any);
      assert.equal(response.status, 200);
      assert.equal(deleteUrls.some((url) => /appointments|medications|care_profiles|family_groups\?id=/.test(url)), false);
    });
  });
}

test("read-only member is rejected by remaining shared-care mutation handlers", async () => {
  let writeAttempted = false;
  const document = {
    id: 700,
    group_id: ATTACKER_GROUP_ID,
    profile_id: 501,
    status: "processing",
    storage_bucket: null,
    storage_path: null,
  };

  await withMockedFetch((url, init) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
      return json([{ user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "member", can_manage: false }]);
    }
    const base = baseRoutes(url);
    if (base) return base;
    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) return json([careProfileRow(501)]);
    if (url.includes(`/rest/v1/care_profiles?group_id=eq.${ATTACKER_GROUP_ID}`)) return json([careProfileRow(501)]);
    if (url.includes("/rest/v1/family_groups?id=in.(100)")) return json([groupRow()]);
    if (url.includes("/rest/v1/care_documents?id=eq.700")) return json([document]);
    if (init?.method && init.method !== "GET") {
      writeAttempted = true;
      return json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const contexts: Array<Response | Promise<Response>> = [
      patchDocument({ request: makePatchRequest("documents", 700, { document_title: "不可改" }), env: ENV, params: { id: "700" } } as any),
      deleteDocument({ request: makeDeleteRequest("/api/documents/700"), env: ENV, params: { id: "700" } } as any),
      patchProfile({ request: makePatchRequest("profiles", 501, { display_name: "不可改" }), env: ENV, params: { id: "501" } } as any),
      orderProfiles({ request: makePatchRequest("profiles/order", 0, { profile_ids: [501] }), env: ENV, params: {} } as any),
      mutateGroups({ request: makePostRequest("/api/groups", { action: "create_profile", group_id: ATTACKER_GROUP_ID, display_name: "不可建" }), env: ENV, params: {} } as any),
      mutateGroups({ request: makePostRequest("/api/groups", { action: "update_family_notes", group_id: ATTACKER_GROUP_ID, notes: ["不可改"] }), env: ENV, params: {} } as any),
      confirmOcr({ request: makePostRequest("/api/ocr/confirm", { document_id: 700 }), env: ENV, params: {} } as any),
    ];

    const uploadForm = new FormData();
    uploadForm.set("profile_id", "501");
    uploadForm.set("file", new File(["fake"], "fake.txt", { type: "text/plain" }));
    contexts.push(uploadDocument({
      request: new Request("https://care.example/api/documents/upload", { method: "POST", headers: { Authorization: "Bearer line-attacker-id-token" }, body: uploadForm }),
      env: ENV,
      params: {},
    } as any));

    const ocrForm = new FormData();
    ocrForm.set("profile_id", "501");
    ocrForm.set("medical_text", "測試藥單");
    contexts.push(runOcr({
      request: new Request("https://care.example/api/ocr", { method: "POST", headers: { Authorization: "Bearer line-attacker-id-token" }, body: ocrForm }),
      env: ENV,
      params: {},
    } as any));

    const responses = await Promise.all(contexts);
    responses.forEach((response) => assert.equal(response.status, 403));
    assert.equal(writeAttempted, false, "read-only mutations must stop before any write request");
  });
});

test("read-only family member can still read family documents", async () => {
  await withMockedFetch((url) => {
    if (url.includes(`/rest/v1/user_family_groups?user_id=eq.${ATTACKER_USER_ID}`)) {
      return json([{ user_id: ATTACKER_USER_ID, group_id: ATTACKER_GROUP_ID, role: "member", can_manage: false }]);
    }
    const base = baseRoutes(url);
    if (base) return base;
    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) return json([careProfileRow(501)]);
    if (url.includes("/rest/v1/care_documents?") && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const response = await listDocuments({
      request: makeGetRequest("/api/documents"),
      env: ENV,
      params: {},
    } as any);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { documents: [] });
  });
});

test("rejects PATCH on an appointment owned by another tenant's group (403)", async () => {
  const VICTIM_APPOINTMENT_ID = 997;
  let patchAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/appointments?id=eq.${VICTIM_APPOINTMENT_ID}`) && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([]);
    }
    if (url.includes(`/rest/v1/appointments?id=eq.${VICTIM_APPOINTMENT_ID}`) && init?.method === "PATCH") {
      patchAttempted = true;
      return json([appointmentRow(VICTIM_APPOINTMENT_ID, 200)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchAppointment({
      request: makePatchRequest("appointments", VICTIM_APPOINTMENT_ID, { title: "越權修改" }),
      env: ENV,
      params: { id: String(VICTIM_APPOINTMENT_ID) },
    } as any);

    assert.equal(res.status, 403, "cross-tenant appointment PATCH must be forbidden");
    assert.equal(patchAttempted, false, "must not issue an appointment write for a foreign record");
  });
});

test("allows PATCH on an appointment the user's group owns (200)", async () => {
  const OWNED_APPOINTMENT_ID = 887;
  let patched = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/appointments?id=eq.${OWNED_APPOINTMENT_ID}`) && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([{ id: OWNED_APPOINTMENT_ID }]);
    }
    if (url.includes(`/rest/v1/appointments?id=eq.${OWNED_APPOINTMENT_ID}`) && init?.method === "PATCH") {
      patched = true;
      return json([appointmentRow(OWNED_APPOINTMENT_ID)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchAppointment({
      request: makePatchRequest("appointments", OWNED_APPOINTMENT_ID, { title: "更新回診" }),
      env: ENV,
      params: { id: String(OWNED_APPOINTMENT_ID) },
    } as any);

    assert.equal(res.status, 200, "owner appointment PATCH must succeed");
    assert.equal(patched, true, "owner appointment PATCH must reach the write");
  });
});

test("rejects POST appointment for a profile outside the user's groups (403)", async () => {
  const VICTIM_PROFILE_ID = 986;
  let insertAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(501)]);
    }
    if (url.includes("/rest/v1/appointments?select=*") && init?.method === "POST") {
      insertAttempted = true;
      return json([appointmentRow(985, 200)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await createAppointment({
      request: makePostRequest("/api/appointments", {
        profile_id: VICTIM_PROFILE_ID,
        type: "clinic_visit",
        date: "2026-06-22",
        title: "越權新增",
      }),
      env: ENV,
    } as any);

    assert.equal(res.status, 403, "cross-tenant appointment POST must be forbidden");
    assert.equal(insertAttempted, false, "must not insert an appointment for a foreign profile");
  });
});

test("allows POST appointment for an owned profile and writes the owned group scope", async () => {
  const OWNED_PROFILE_ID = 501;
  let insertedPayload: any = null;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(OWNED_PROFILE_ID)]);
    }
    if (url.includes("/rest/v1/appointments?select=*") && init?.method === "POST") {
      insertedPayload = JSON.parse(String(init.body || "{}"));
      return json([appointmentRow(984)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await createAppointment({
      request: makePostRequest("/api/appointments", {
        profile_id: OWNED_PROFILE_ID,
        type: "clinic_visit",
        date: "2026-06-22",
        title: "新增回診",
      }),
      env: ENV,
    } as any);

    assert.equal(res.status, 200, "owned appointment POST must succeed");
    assert.equal(insertedPayload.user_id, ATTACKER_USER_ID);
    assert.equal(insertedPayload.created_by_user_id, ATTACKER_USER_ID);
    assert.equal(insertedPayload.group_id, ATTACKER_GROUP_ID);
    assert.equal(insertedPayload.profile_id, OWNED_PROFILE_ID);
  });
});

test("rejects PATCH on a care profile outside the user's groups (403)", async () => {
  const VICTIM_PROFILE_ID = 996;
  let patchAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(501)]);
    }
    if (url.includes(`/rest/v1/care_profiles?id=eq.${VICTIM_PROFILE_ID}`) && init?.method === "PATCH") {
      patchAttempted = true;
      return json([careProfileRow(VICTIM_PROFILE_ID, 200)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchProfile({
      request: makePatchRequest("profiles", VICTIM_PROFILE_ID, { display_name: "越權修改" }),
      env: ENV,
      params: { id: String(VICTIM_PROFILE_ID) },
    } as any);

    assert.equal(res.status, 403, "cross-tenant profile PATCH must be forbidden");
    assert.equal(patchAttempted, false, "must not issue a profile write for a foreign record");
  });
});

test("allows PATCH on a care profile in the user's group (200)", async () => {
  const OWNED_PROFILE_ID = 886;
  let patched = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(OWNED_PROFILE_ID)]);
    }
    if (url.includes(`/rest/v1/care_profiles?id=eq.${OWNED_PROFILE_ID}`) && init?.method === "PATCH") {
      patched = true;
      return json([careProfileRow(OWNED_PROFILE_ID)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchProfile({
      request: makePatchRequest("profiles", OWNED_PROFILE_ID, { display_name: "更新姓名" }),
      env: ENV,
      params: { id: String(OWNED_PROFILE_ID) },
    } as any);

    assert.equal(res.status, 200, "owner profile PATCH must succeed");
    assert.equal(patched, true, "owner profile PATCH must reach the write");
  });
});

test("rejects PATCH on a care document outside the user's groups (404)", async () => {
  const VICTIM_DOCUMENT_ID = 995;
  let patchAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${VICTIM_DOCUMENT_ID}`)
      && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)
    ) {
      return json([]);
    }
    if (url.includes(`/rest/v1/care_documents?id=eq.${VICTIM_DOCUMENT_ID}`) && init?.method === "PATCH") {
      patchAttempted = true;
      return json([documentRow(VICTIM_DOCUMENT_ID, 200)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchDocument({
      request: makePatchRequest("documents", VICTIM_DOCUMENT_ID, { document_title: "越權修改" }),
      env: ENV,
      params: { id: String(VICTIM_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 404, "cross-tenant document PATCH must not reveal the record");
    assert.equal(patchAttempted, false, "must not issue a document write for a foreign record");
  });
});

test("allows PATCH on a care document in the user's group (200)", async () => {
  const OWNED_DOCUMENT_ID = 885;
  let patched = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes(`/rest/v1/care_profiles?group_id=in.(${ATTACKER_GROUP_ID})`)) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${OWNED_DOCUMENT_ID}`)
      && url.includes(`group_id=in.(${ATTACKER_GROUP_ID})`)
    ) {
      return json([documentRow(OWNED_DOCUMENT_ID)]);
    }
    if (url.includes(`/rest/v1/care_documents?id=eq.${OWNED_DOCUMENT_ID}`) && init?.method === "PATCH") {
      patched = true;
      return json([documentRow(OWNED_DOCUMENT_ID)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await patchDocument({
      request: makePatchRequest("documents", OWNED_DOCUMENT_ID, { document_title: "更新文件" }),
      env: ENV,
      params: { id: String(OWNED_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 200, "owner document PATCH must succeed");
    assert.equal(patched, true, "owner document PATCH must reach the write");
  });
});

test("rejects medication taken POST when any medication is outside the user's groups (403)", async () => {
  const OWNED_MED_ID = 982;
  const VICTIM_MED_ID = 983;
  let logInsertAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (
      url.includes(`/rest/v1/medications?id=in.(${OWNED_MED_ID},${VICTIM_MED_ID})`)
      && url.includes("select=id,user_id,group_id,profile_id,time_slot,scheduled_time,frequency")
    ) {
      return json([
        medicationRow(OWNED_MED_ID, ATTACKER_GROUP_ID),
        { ...medicationRow(VICTIM_MED_ID, 200), user_id: 2 },
      ]);
    }
    if (url.includes("/rest/v1/medication_logs?select=id") && init?.method === "POST") {
      logInsertAttempted = true;
      return json([{ id: 1 }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await markMedicationsTaken({
      request: makePostRequest("/api/medications/taken", {
        medication_ids: [OWNED_MED_ID, VICTIM_MED_ID],
        taken_date: "2026-06-20",
      }),
      env: ENV,
    } as any);

    assert.equal(res.status, 403, "mixed owned/foreign medication taken POST must be forbidden");
    assert.equal(logInsertAttempted, false, "must not insert medication logs when any medication is foreign");
  });
});

test("allows medication taken POST for owned medications and writes owned group logs", async () => {
  const OWNED_MED_IDS = [980, 981];
  let logPayload: any = null;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (
      url.includes(`/rest/v1/medications?id=in.(${OWNED_MED_IDS.join(",")})`)
      && url.includes("select=id,user_id,group_id,profile_id,time_slot,scheduled_time,frequency")
    ) {
      return json(OWNED_MED_IDS.map((id) => medicationRow(id, ATTACKER_GROUP_ID)));
    }
    if (url.includes("/rest/v1/medication_logs?select=id") && init?.method === "POST") {
      logPayload = JSON.parse(String(init.body || "[]"));
      return json([{ id: 1 }, { id: 2 }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await markMedicationsTaken({
      request: makePostRequest("/api/medications/taken", {
        medication_ids: OWNED_MED_IDS,
        taken_date: "2026-06-20",
      }),
      env: ENV,
    } as any);

    assert.equal(res.status, 200, "owned medication taken POST must succeed");
    assert.equal(Array.isArray(logPayload), true, "batch medication taken must write an array of logs");
    assert.deepEqual(logPayload.map((row: any) => row.medication_id), OWNED_MED_IDS);
    assert.equal(logPayload.every((row: any) => row.group_id === ATTACKER_GROUP_ID), true);
    assert.equal(logPayload.every((row: any) => row.confirmed_by_user_id === ATTACKER_USER_ID), true);
  });
});

test("dashboard read queries stay scoped to the active group and profile", async () => {
  let appointmentScoped = false;
  let medicationScoped = false;
  let medicationLogScoped = false;
  let documentScoped = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/family_groups?id=in.(100)&select=*")) {
      return json([groupRow()]);
    }
    if (url.includes("/rest/v1/users?id=eq.1&select=active_profile_id&limit=1")) {
      return json([{ active_profile_id: 501 }]);
    }
    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (url.includes("/rest/v1/family_groups?id=eq.100&select=plan_id&limit=1")) {
      return json([{ plan_id: "pro" }]);
    }
    if (url.includes("/rest/v1/plans?id=eq.pro&select=*&limit=1")) {
      return json([planRow()]);
    }
    if (url.includes("/rest/v1/usage_quotas?group_id=eq.100")) {
      return json([{ used_count: 0 }]);
    }
    if (url.includes("/rest/v1/user_feature_flags?user_id=eq.1&feature_key=eq.multiple_family_groups")) {
      return json([]);
    }
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=eq.501")) {
      appointmentScoped = true;
      return json([appointmentRow(701)]);
    }
    if (url.includes("/rest/v1/appointments?group_id=eq.100&profile_id=is.null&type=eq.family_note")) {
      return json([]);
    }
    if (url.includes("/rest/v1/medications?group_id=eq.100&profile_id=eq.501")) {
      medicationScoped = true;
      return json([medicationRow(702)]);
    }
    if (url.includes("/rest/v1/care_documents?group_id=eq.100&profile_id=eq.501")) {
      documentScoped = true;
      return json([documentRow(703)]);
    }
    if (url.includes("/rest/v1/user_family_groups?group_id=eq.100&select=user_id,role")) {
      return json([]);
    }
    if (url.includes("/rest/v1/line_push_logs?group_id=eq.100")) {
      return json([]);
    }
    if (
      url.includes("/rest/v1/medication_logs?medication_id=in.(702)")
      && url.includes("group_id=in.(100)")
    ) {
      medicationLogScoped = true;
      return json([]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await getDashboard({
      request: makeGetRequest("/api/dashboard?group_id=100&profile_id=501"),
      env: ENV,
    } as any);

    assert.equal(res.status, 200, "dashboard read should succeed for the owned group/profile");
    const body = await res.json() as any;
    assert.equal(body.active_group_id, ATTACKER_GROUP_ID);
    assert.deepEqual(body.appointments.map((item: any) => item.id), [701]);
    assert.deepEqual(body.medications.map((item: any) => item.id), [702]);
    assert.deepEqual(body.documents.map((item: any) => item.id), [703]);
    assert.equal(appointmentScoped, true, "appointments must be queried by active group and profile");
    assert.equal(medicationScoped, true, "medications must be queried by active group and profile");
    assert.equal(medicationLogScoped, true, "medication logs must be constrained by owned medication group");
    assert.equal(documentScoped, true, "documents must be queried by active group and profile");
  });
});

test("documents list never queries without the user's group scope", async () => {
  let documentListScoped = false;

  await withMockedFetch((url) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes("/rest/v1/care_documents?")
      && url.includes("group_id=in.(100)")
      && url.includes("status=neq.deleted")
    ) {
      documentListScoped = true;
      return json([documentRow(704)]);
    }
    if (url.includes("/rest/v1/care_documents?")) {
      throw new Error(`unscoped document list query: ${url}`);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await listDocuments({
      request: makeGetRequest("/api/documents"),
      env: ENV,
    } as any);

    assert.equal(res.status, 200, "documents list should succeed for owned groups");
    const body = await res.json() as any;
    assert.deepEqual(body.documents.map((item: any) => item.id), [704]);
    assert.equal(documentListScoped, true, "documents list must include group_id=in.(accessibleGroupIds)");
  });
});

test("document detail keeps linked records scoped to the document group", async () => {
  const OWNED_DOCUMENT_ID = 705;
  let linkedAppointmentsScoped = false;
  let linkedMedicationsScoped = false;

  await withMockedFetch((url) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${OWNED_DOCUMENT_ID}`)
      && url.includes("group_id=in.(100)")
    ) {
      return json([documentRow(OWNED_DOCUMENT_ID)]);
    }
    if (
      url.includes(`/rest/v1/appointments?source_document_id=eq.${OWNED_DOCUMENT_ID}`)
      && url.includes("group_id=eq.100")
    ) {
      linkedAppointmentsScoped = true;
      return json([appointmentRow(706)]);
    }
    if (
      url.includes(`/rest/v1/medications?source_document_id=eq.${OWNED_DOCUMENT_ID}`)
      && url.includes("group_id=eq.100")
    ) {
      linkedMedicationsScoped = true;
      return json([medicationRow(707)]);
    }
    if (url.includes(`source_document_id=eq.${OWNED_DOCUMENT_ID}`)) {
      throw new Error(`unscoped linked record query: ${url}`);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await getDocument({
      request: makeGetRequest(`/api/documents/${OWNED_DOCUMENT_ID}`),
      env: ENV,
      params: { id: String(OWNED_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 200, "document detail should succeed for an owned document");
    const body = await res.json() as any;
    assert.deepEqual(body.document.linked_appointments.map((item: any) => item.id), [706]);
    assert.deepEqual(body.document.linked_medications.map((item: any) => item.id), [707]);
    assert.equal(linkedAppointmentsScoped, true, "linked appointments must be scoped to the document group");
    assert.equal(linkedMedicationsScoped, true, "linked medications must be scoped to the document group");
  });
});

test("rejects signed file URLs for a care document outside the user's groups (404)", async () => {
  const VICTIM_DOCUMENT_ID = 708;
  let signedUrlAttempted = false;

  await withMockedFetch((url) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${VICTIM_DOCUMENT_ID}`)
      && url.includes("group_id=in.(100)")
    ) {
      return json([]);
    }
    if (url.includes("/storage/v1/object/sign/")) {
      signedUrlAttempted = true;
      return json({ signedURL: "/object/sign/private" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await getDocumentFileUrl({
      request: makeGetRequest(`/api/documents/${VICTIM_DOCUMENT_ID}/file-url`),
      env: ENV,
      params: { id: String(VICTIM_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 404, "foreign document file URL must not reveal the record");
    assert.equal(signedUrlAttempted, false, "must not ask Supabase Storage for a foreign document signed URL");
  });
});

test("rejects DELETE on a care document outside the user's groups without touching storage", async () => {
  const VICTIM_DOCUMENT_ID = 709;
  let storageDeleteAttempted = false;
  let softDeleteAttempted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${VICTIM_DOCUMENT_ID}`)
      && url.includes("group_id=in.(100)")
    ) {
      return json([]);
    }
    if (url.includes("/storage/v1/object/") && init?.method === "DELETE") {
      storageDeleteAttempted = true;
      return json({});
    }
    if (url.includes(`/rest/v1/care_documents?id=eq.${VICTIM_DOCUMENT_ID}`) && init?.method === "PATCH") {
      softDeleteAttempted = true;
      return json([documentRow(VICTIM_DOCUMENT_ID, 200)]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await deleteDocument({
      request: makeDeleteRequest(`/api/documents/${VICTIM_DOCUMENT_ID}`),
      env: ENV,
      params: { id: String(VICTIM_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 404, "foreign document DELETE must not reveal the record");
    assert.equal(storageDeleteAttempted, false, "must not delete a storage object for a foreign document");
    assert.equal(softDeleteAttempted, false, "must not soft-delete a foreign document row");
  });
});

test("owned care document DELETE removes the scoped storage object before soft delete", async () => {
  const OWNED_DOCUMENT_ID = 710;
  const storagePath = "group-100/profile-501/2026-06/report.pdf";
  let storageDeletePrefix: string | null = null;
  let softDeleted = false;

  await withMockedFetch((url, init) => {
    const base = baseRoutes(url);
    if (base) return base;

    if (url.includes("/rest/v1/care_profiles?group_id=in.(100)")) {
      return json([careProfileRow(501)]);
    }
    if (
      url.includes(`/rest/v1/care_documents?id=eq.${OWNED_DOCUMENT_ID}`)
      && url.includes("group_id=in.(100)")
    ) {
      return json([{ ...documentRow(OWNED_DOCUMENT_ID), storage_bucket: "care-documents", storage_path: storagePath }]);
    }
    if (url.includes("/storage/v1/object/care-documents") && init?.method === "DELETE") {
      const body = JSON.parse(String(init.body || "{}"));
      storageDeletePrefix = body.prefixes?.[0] || null;
      return json({});
    }
    if (url.includes(`/rest/v1/care_documents?id=eq.${OWNED_DOCUMENT_ID}`) && init?.method === "PATCH") {
      softDeleted = true;
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.status, "deleted");
      assert.equal(body.storage_path, null);
      assert.equal(body.storage_bucket, null);
      return json([{ ...documentRow(OWNED_DOCUMENT_ID), status: "deleted", storage_bucket: null, storage_path: null }]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    const res = await deleteDocument({
      request: makeDeleteRequest(`/api/documents/${OWNED_DOCUMENT_ID}`),
      env: ENV,
      params: { id: String(OWNED_DOCUMENT_ID) },
    } as any);

    assert.equal(res.status, 200, "owned document DELETE must succeed");
    assert.equal(storageDeletePrefix, storagePath, "storage delete must target the owned document storage path");
    assert.equal(softDeleted, true, "owned document DELETE must soft-delete the row");
  });
});

test("care document upload storage paths are namespaced by group and profile", () => {
  const path = buildStoragePath(
    ATTACKER_GROUP_ID,
    501,
    { name: "hospital-report.pdf", type: "application/pdf" } as File,
  );

  assert.match(path, /^group-100\/profile-501\/\d{4}-\d{2}\/[0-9a-f-]+\.pdf$/i);
  assert.doesNotMatch(path, /hospital-report/i, "storage path must not retain original medical file names");
  assert.doesNotMatch(path, /\.\./, "storage path must not allow path traversal segments");
});
