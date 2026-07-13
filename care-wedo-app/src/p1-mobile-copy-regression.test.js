import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("elder today view and care circle use explicit role sections", () => {
  const app = readProjectFile("care-wedo-app/src/App.jsx");

  assert.match(app, /今天用藥/);
  assert.match(app, /家庭與成員/);
  assert.match(app, /提醒與通知/);
  assert.match(app, /照護資料/);
  assert.match(app, /費用與帳號/);
  assert.match(app, /目前為測試模式：不會實際扣款/);
});

test("medication completion copy identifies the slot and actor", () => {
  const medicationView = readProjectFile("care-wedo-app/src/features/medications/MedicationView.jsx");

  assert.match(medicationView, /標記本次已服用/);
  assert.match(medicationView, /操作者/);
  assert.match(medicationView, /recordedAt|taken_at/);
  assert.doesNotMatch(medicationView, /我已吃完/);
});

test("mobile shell prevents long identity text and bottom navigation overlap", () => {
  const css = readProjectFile("care-wedo-app/src/index.css");
  assert.match(css, /\.mobile-bottom-nav[\s\S]*padding-bottom:\s*calc\(/);
  assert.match(css, /\.care-shell[\s\S]*padding-bottom:\s*calc\(/);
  assert.match(css, /\.account-sub[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.mobile-bottom-nav strong[\s\S]*overflow-wrap:\s*anywhere/);
});
