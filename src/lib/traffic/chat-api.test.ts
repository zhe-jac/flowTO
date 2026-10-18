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

test("chat resolves cross-street proposals and responds with clarification when the extent is unclear", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    const action = { kind: "closure", title: "Queen closure", roadName: "Queen Street West", fromStreet: "Spadina Avenue", toStreet: "University Avenue", venueId: "", attendance: 0, restriction: "full-closure", startMinutes: 1020, durationMinutes: 120 };
    let supplied: Record<string, unknown> = {};
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      supplied = JSON.parse(payload.contents.at(-1).parts[0].text).context;
      assert.ok(payload.generationConfig.responseJsonSchema.properties.actions.items.required.includes("fromStreet"));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Review this proposed closure.", actions: [action] }) }] } }] });
    };
    const response = await POST(request({ ...body, messages: [{ role: "user", content: "Close Queen St W from Spadina to University, 5pm to 7pm" }] }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.proposals.length, 1);
    assert.ok(result.proposals[0].roadSections.length > 1);
    assert.match(result.proposals[0].locationLabel, /Spadina Ave → University Ave/);
    assert.ok(supplied.streetPlacement);
    const hubResponse = await POST(request({ ...body, messages: [{ role: "user", content: "How is traffic around North York Centre?" }] }));
    assert.equal(hubResponse.status, 200);
    assert.ok((supplied.requestedRoads as unknown[]).length > 0);
    action.toStreet = "invented street";
    const clarification = await POST(request(body));
    const clarified = await clarification.json();
    assert.equal(clarification.status, 200);
    assert.deepEqual(clarified.proposals, []);
    assert.match(clarified.reply, /could not find/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("chat rejects malformed or inconsistent directional traffic impacts", async () => {
  for (const addedByDirection of [[400], [400, -1], [100, 100], [400, null], "bad"]) {
    const response = await POST(request({ ...body, context: { ...body.context, impacts: { road: { addedHourly: 400, retained: 1, capacityScale: 1, addedByDirection } } } }));
    assert.equal(response.status, 400);
  }
});
