import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../../app/api/traffic/chat/route";
const body = { messages: [{ role: "user", content: "Add a concert at Scotiabank Arena with 15000 attendees from 7pm to 11pm" }], context: { date: "2026-10-17", minutes: 1020, day: "weekend", source: "baseline", impacts: {} }, items: [], weather: { rainMmPerHour: 0, snowCmPerHour: 0 } };
const request = (value: unknown) => new Request("http://localhost/api/traffic/chat", { method: "POST", body: JSON.stringify(value) });
test("chat endpoint validates requests, uses server data and returns only validated proposals", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    let prompt = "";
    globalThis.fetch = async (_url, init) => {
      prompt = String(init?.body);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Review this proposed event.", actions: [{ kind: "event", title: "Concert", venueId: "scotiabank-arena", attendance: 15000, startMinutes: 1140, durationMinutes: 240 }] }) }] } }] });
    };
    assert.equal((await POST(request({}))).status, 400);
    const response = await POST(request(body));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.proposals[0].attendance, 15000);
    assert.ok(prompt.includes("employmentStats") && prompt.includes("publishedEvents"));
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"reply":"Bad proposal","actions":[{"kind":"event","venueId":"invented"}]}' }] } }] });
    assert.equal((await POST(request(body))).status, 502);
    globalThis.fetch = async () => new Response("", { status: 429 });
    assert.match((await (await POST(request(body))).json()).error, /rate limit/);
    delete process.env.GEMINI_API_KEY;
    assert.equal((await POST(request(body))).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});
