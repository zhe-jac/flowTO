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

test("chat grounds a mistaken ramp selection in the user's Gardiner mainline request", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    let names: string[] = [];
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      names = JSON.parse(payload.contents.at(-1).parts[0].text).context.roadCandidates.map((r: { name: string }) => r.name);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Review the closure.", actions: [{ kind: "closure", title: "Gardiner closure", roadName: "Gardiner Lakeshore W Ramp", fromStreet: "Spadina Rd", toStreet: "York St", travelDirection: "westbound", startMinutes: 1020, durationMinutes: 120 }] }) }] } }] });
    };
    const response = await POST(request({ ...body, messages: [{ role: "user", content: "close both ways of the gardiner expy from spadina ave to york st from 5 PM to 7 PM" }], mapReference: [-79.39, 43.64] }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.proposals.length, 2, JSON.stringify(result));
    assert.ok(result.proposals[0].groupId);
    assert.equal(result.proposals[0].groupId, result.proposals[1].groupId);
    assert.notEqual(result.proposals[0].id, result.proposals[1].id);
    assert.deepEqual(new Set(result.proposals.map((p: { travelDirection: string }) => p.travelDirection)), new Set(["eastbound", "westbound"]));
    assert.equal(result.preview.features.length, 9);
    assert.ok(names.includes("F G Gardiner Xy E") && names.includes("F G Gardiner Xy W"));
    const { trafficData } = await import("./server-data");
    const { prepareSimulation } = await import("./simulation-network");
    const simulation = prepareSimulation(await trafficData(), { items: result.proposals, date: body.context.date, minutes: 1020, weather: body.weather });
    assert.equal(simulation.operations.length, 2);
    assert.equal(simulation.operations.reduce((sum, operation) => sum + operation.edges.length, 0), 9);
    assert.ok(simulation.operations.every(operation => operation.capacity === 0));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("chat returns previewable alternatives when an explicit street suffix conflicts with its limits", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Review.", actions: [{ kind: "closure", title: "Queen closure", roadName: "Queen St W", fromStreet: "Spadina", toStreet: "Jarvis", startMinutes: 1020, durationMinutes: 120 }] }) }] } }] });
    const response = await POST(request({ ...body, messages: [{ role: "user", content: "Close Queen Street West from Spadina to Jarvis from 5 PM to 7 PM" }] }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.proposals, []);
    assert.ok(result.locationChoices.length);
    assert.match(result.locationChoices[0].label, /Queen St W \/ Queen St E/);
    assert.ok(result.locationChoices[0].preview.features.length > 1);
    assert.equal(result.locationChoices[0].proposals[0].travelDirection, "both");
    const generic = await (await POST(request({ ...body, messages: [{ role: "user", content: "Close Queen Street from Spadina to Jarvis from 5 PM to 7 PM" }] }))).json();
    assert.equal(generic.proposals.length, 1);
    assert.match(generic.proposals[0].locationLabel, /Queen St W \/ Queen St E/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});
