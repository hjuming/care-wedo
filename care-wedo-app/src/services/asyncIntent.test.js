import assert from "node:assert/strict";
import test from "node:test";

import { createLatestIntentQueue, createLatestRequestGate, createRetryKeyStore } from "./asyncIntent.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("latest intent queue persists the final profile after an older request finishes", async () => {
  const firstRequest = deferred();
  const calls = [];
  const queue = createLatestIntentQueue(async (profileId) => {
    calls.push(profileId);
    if (profileId === "profile-a") await firstRequest.promise;
  });

  queue.push("profile-a");
  queue.push("profile-b");
  queue.push("profile-c");

  assert.deepEqual(calls, ["profile-a"]);
  firstRequest.resolve();
  await queue.whenIdle();

  assert.deepEqual(calls, ["profile-a", "profile-c"]);
});

test("latest intent queue continues with the final profile after an older write fails", async () => {
  const errors = [];
  const calls = [];
  const queue = createLatestIntentQueue(
    async (profileId) => {
      calls.push(profileId);
      if (profileId === "profile-a") throw new Error("temporary failure");
    },
    { onError: (error, profileId) => errors.push([error.message, profileId]) },
  );

  queue.push("profile-a");
  queue.push("profile-b");
  await queue.whenIdle();

  assert.deepEqual(calls, ["profile-a", "profile-b"]);
  assert.deepEqual(errors, [["temporary failure", "profile-a"]]);
});

test("latest request gate rejects a closed or superseded document response", () => {
  const gate = createLatestRequestGate();
  const documentA = gate.begin();
  const documentB = gate.begin();

  assert.equal(gate.isCurrent(documentA), false);
  assert.equal(gate.isCurrent(documentB), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(documentB), false);
});

test("retry key store reuses a timed-out medication operation and rotates after success", () => {
  let sequence = 0;
  const store = createRetryKeyStore(() => `operation-${++sequence}`);

  const firstAttempt = store.get("2026-07-19:morning:taken:11,12");
  const retryAttempt = store.get("2026-07-19:morning:taken:11,12");
  assert.equal(retryAttempt, firstAttempt);

  store.clear("2026-07-19:morning:taken:11,12", firstAttempt);
  assert.notEqual(store.get("2026-07-19:morning:taken:11,12"), firstAttempt);
});
