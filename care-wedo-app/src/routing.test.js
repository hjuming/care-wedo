import test from "node:test";
import assert from "node:assert/strict";
import { isLineCallbackSearch, resolveCareWedoRoute, resolveInitialCareWedoRoute } from "./routing.js";

test("resolveCareWedoRoute sends the root homepage to the public landing page", () => {
  assert.equal(resolveCareWedoRoute("/"), "landing");
});

test("resolveCareWedoRoute sends the app path to the care dashboard", () => {
  assert.equal(resolveCareWedoRoute("/app"), "app");
  assert.equal(resolveCareWedoRoute("/app/"), "app");
  assert.equal(resolveCareWedoRoute("/app?code=abc&liff.state=%2Fapp"), "app");
  assert.equal(resolveCareWedoRoute("/app#dashboard"), "app");
});

test("resolveCareWedoRoute sends LINE external-open paths to the browser handoff page", () => {
  assert.equal(resolveCareWedoRoute("/app/open"), "external-open");
  assert.equal(resolveCareWedoRoute("/open"), "external-open");
});

test("resolveCareWedoRoute sends the login path to the login page", () => {
  assert.equal(resolveCareWedoRoute("/login"), "login");
});

test("resolveCareWedoRoute sends Supabase Auth callbacks to the callback page", () => {
  assert.equal(resolveCareWedoRoute("/auth/callback"), "auth-callback");
  assert.equal(resolveCareWedoRoute("/auth/callback?next=%2Fapp"), "auth-callback");
});

test("resolveCareWedoRoute keeps product information pages outside the dashboard", () => {
  assert.equal(resolveCareWedoRoute("/about"), "features");
  assert.equal(resolveCareWedoRoute("/features"), "features");
  assert.equal(resolveCareWedoRoute("/features#feedback"), "features");
});

test("resolveCareWedoRoute sends the privacy path to the privacy page", () => {
  assert.equal(resolveCareWedoRoute("/privacy"), "privacy");
});

test("resolveCareWedoRoute sends the terms path to the terms page", () => {
  assert.equal(resolveCareWedoRoute("/terms"), "terms");
});

test("resolveCareWedoRoute falls back to the public landing page", () => {
  assert.equal(resolveCareWedoRoute("/pricing"), "landing");
});

test("resolveInitialCareWedoRoute sends LINE callback URLs to the app without changing the URL first", () => {
  assert.equal(resolveInitialCareWedoRoute("/", "?liff.state=%2Fapp&code=abc"), "app");
  assert.equal(resolveInitialCareWedoRoute("/", "?code=abc"), "app");
  assert.equal(resolveInitialCareWedoRoute("/login", "?liff.state=%2Fapp"), "app");
});

test("isLineCallbackSearch detects LIFF and OAuth callback parameters", () => {
  assert.equal(isLineCallbackSearch("?liff.state=%2Fapp"), true);
  assert.equal(isLineCallbackSearch("?code=abc"), true);
  assert.equal(isLineCallbackSearch("?state=abc"), false);
});
