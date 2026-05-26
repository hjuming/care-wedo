import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("LINE appointment summaries compute weekdays from calendar dates, not runtime timezone", () => {
  const callback = readProjectFile("functions/callback.ts");

  assert.doesNotMatch(callback, /T00:00:00\+08:00`\)\.getDay\(\)/);
  assert.match(callback, /getUTCDay\(\)/);
});

test("LINE cron reminder date labels compute weekdays from calendar dates, not runtime timezone", () => {
  const reminders = readProjectFile("functions/api/cron/reminders.ts");

  assert.doesNotMatch(reminders, /T00:00:00\+08:00`\)\.getDay\(\)/);
  assert.match(reminders, /getUTCDay\(\)/);
});
