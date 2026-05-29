import test from "node:test";
import assert from "node:assert/strict";
import { buildCollaboratorContact, normalizeLineContactId } from "./contact.js";

test("normalizeLineContactId rejects LINE internal U ids", () => {
  assert.equal(normalizeLineContactId("U4907016919ebe34bd121004ac9cc5829"), null);
});

test("normalizeLineContactId keeps public LINE ids", () => {
  assert.equal(normalizeLineContactId("@carewedo"), "@carewedo");
  assert.equal(normalizeLineContactId("family.ming"), "family.ming");
});

test("buildCollaboratorContact prefers a public LINE id", () => {
  assert.deepEqual(buildCollaboratorContact({ lineUserId: "@carewedo", email: "care@example.com" }), {
    type: "line",
    href: "https://line.me/R/ti/p/%40carewedo",
    label: "LINE",
  });
});

test("buildCollaboratorContact falls back to email when only an internal LINE user id exists", () => {
  assert.deepEqual(buildCollaboratorContact({
    lineUserId: "U4907016919ebe34bd121004ac9cc5829",
    email: "care@example.com",
  }), {
    type: "email",
    href: "mailto:care@example.com",
    label: "Email",
  });
});

test("buildCollaboratorContact returns a setup fallback when no direct contact exists", () => {
  assert.deepEqual(buildCollaboratorContact({
    lineUserId: "U4907016919ebe34bd121004ac9cc5829",
    email: "",
  }), {
    type: "none",
    href: null,
    label: "補聯絡方式",
  });
});
