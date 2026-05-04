import test from "node:test";
import assert from "node:assert/strict";
import { resolveCareWedoRoute } from "./routing.js";

test("resolveCareWedoRoute sends the public homepage to the landing page", () => {
  assert.equal(resolveCareWedoRoute("/"), "landing");
});

test("resolveCareWedoRoute sends the app path to the care dashboard", () => {
  assert.equal(resolveCareWedoRoute("/app"), "app");
  assert.equal(resolveCareWedoRoute("/app/"), "app");
});

test("resolveCareWedoRoute sends the login path to the login page", () => {
  assert.equal(resolveCareWedoRoute("/login"), "login");
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
