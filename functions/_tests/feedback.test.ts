import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as submitFeedback } from "../api/feedback";

const ENV = {
  EMAILJS_SERVICE_ID: "service-test",
  EMAILJS_TEMPLATE_ID: "template-test",
  EMAILJS_PUBLIC_KEY: "public-test",
};

const VALID_FEEDBACK = {
  name: "王小明",
  email: "care@example.com",
  topic: "操作建議",
  message: "按鈕文字可以再更清楚。",
};

function request(body: unknown, contentLength?: number) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (contentLength !== undefined) headers.set("Content-Length", String(contentLength));
  return new Request("https://care.example/api/feedback", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function withEmailJsMock(run: (calls: Array<{ url: string; body: any }>) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, body: JSON.parse(String(init?.body || "{}")) });
    return new Response("OK", { status: 200 });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

async function post(body: unknown, contentLength?: number) {
  return submitFeedback({ request: request(body, contentLength), env: ENV, params: {} } as any);
}

test("feedback rejects an oversized Content-Length before EmailJS", async () => {
  await withEmailJsMock(async (calls) => {
    const response = await post(VALID_FEEDBACK, 8193);
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
});

test("feedback rejects an actually oversized UTF-8 body without trusting Content-Length", async () => {
  await withEmailJsMock(async (calls) => {
    const response = await post({ ...VALID_FEEDBACK, message: "長".repeat(8193) });
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
  });
});

test("feedback validates required fields, types, email format, and field limits before EmailJS", async (t) => {
  const invalidCases = [
    ["message required", { ...VALID_FEEDBACK, message: " " }],
    ["email required", { ...VALID_FEEDBACK, email: " " }],
    ["email format", { ...VALID_FEEDBACK, email: "not-an-email" }],
    ["string types", { ...VALID_FEEDBACK, name: 123 }],
    ["name max 100", { ...VALID_FEEDBACK, name: "a".repeat(101) }],
    ["email max 254", { ...VALID_FEEDBACK, email: `${"a".repeat(243)}@example.com` }],
    ["topic max 100", { ...VALID_FEEDBACK, topic: "a".repeat(101) }],
    ["message max 4000", { ...VALID_FEEDBACK, message: "a".repeat(4001) }],
  ] as const;

  for (const [name, body] of invalidCases) {
    await t.test(name, async () => {
      await withEmailJsMock(async (calls) => {
        const response = await post(body);
        assert.equal(response.status, 400);
        assert.equal(calls.length, 0);
      });
    });
  }
});

test("feedback keeps the existing EmailJS contract for a valid request", async () => {
  await withEmailJsMock(async (calls) => {
    const response = await post({ ...VALID_FEEDBACK, ignored: "unknown field" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.emailjs.com/api/v1.0/email/send");
    assert.equal(calls[0].body.service_id, ENV.EMAILJS_SERVICE_ID);
    assert.equal(calls[0].body.template_id, ENV.EMAILJS_TEMPLATE_ID);
    assert.equal(calls[0].body.user_id, ENV.EMAILJS_PUBLIC_KEY);
    assert.equal(calls[0].body.template_params.name, VALID_FEEDBACK.name);
    assert.equal(calls[0].body.template_params.email, VALID_FEEDBACK.email);
    assert.equal(calls[0].body.template_params.topic, VALID_FEEDBACK.topic);
    assert.equal(calls[0].body.template_params.message, VALID_FEEDBACK.message);
    assert.equal("ignored" in calls[0].body.template_params, false);
  });
});

test("feedback rejects malformed JSON and non-object roots before EmailJS", async (t) => {
  const invalidBodies = [
    ["malformed JSON", "{not-json"],
    ["null root", null],
    ["array root", []],
    ["string root", JSON.stringify("feedback")],
    ["number root", "123"],
  ] as const;

  for (const [name, body] of invalidBodies) {
    await t.test(name, async () => {
      await withEmailJsMock(async (calls) => {
        const response = await post(body);
        assert.equal(response.status, 400);
        assert.equal(calls.length, 0);
      });
    });
  }
});

test("feedback rejects every known field when its value is not a string", async (t) => {
  for (const field of ["name", "email", "topic", "message"] as const) {
    await t.test(field, async () => {
      await withEmailJsMock(async (calls) => {
        const response = await post({ ...VALID_FEEDBACK, [field]: 123 });
        assert.equal(response.status, 400);
        assert.equal(calls.length, 0);
      });
    });
  }
});

test("feedback accepts exact trimmed field limits and sends only trimmed values", async () => {
  const boundary = {
    name: ` ${"n".repeat(100)} `,
    email: ` ${"e".repeat(242)}@example.com `,
    topic: ` ${"t".repeat(100)} `,
    message: ` ${"m".repeat(4000)} `,
  };

  await withEmailJsMock(async (calls) => {
    const response = await post(boundary);
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    const params = calls[0].body.template_params;
    assert.equal(params.name, boundary.name.trim());
    assert.equal(params.email, boundary.email.trim());
    assert.equal(params.topic, boundary.topic.trim());
    assert.equal(params.message, boundary.message.trim());
    assert.equal(params.name.length, 100);
    assert.equal(params.email.length, 254);
    assert.equal(params.topic.length, 100);
    assert.equal(params.message.length, 4000);
  });
});

test("feedback provider errors never log response detail or submitted contact text", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const logs: string[] = [];
  const privateEmail = "private-person@example.com";
  const privateMessage = "PRIVATE-FEEDBACK-MESSAGE";
  globalThis.fetch = (async () => new Response(
    `provider rejected ${privateEmail}: ${privateMessage}`,
    { status: 400 },
  )) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));

  try {
    const response = await post({ ...VALID_FEEDBACK, email: privateEmail, message: privateMessage });
    assert.equal(response.status, 502);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /feedback\.emailjs_send_failed/);
    assert.match(logs[0], /"status":400/);
    assert.doesNotMatch(logs[0], /detail|provider rejected|private-person|PRIVATE-FEEDBACK-MESSAGE/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
