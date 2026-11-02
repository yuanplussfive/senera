import http from "node:http";
import path from "node:path";
import { expect, test } from "vitest";
import { AgentEventKinds, type AgentEventEnvelope } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { readAgentSessionInsights } from "../../../Source/AgentSystem/Session/AgentSessionInsights.js";
import { AgentSessionInsightsHttpApi } from "../../../Source/AgentSystem/Session/AgentSessionInsightsHttpApi.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const event = (
  sequence: number,
  kind: AgentEventEnvelope["kind"] = AgentEventKinds.ModelCompleted,
  data: unknown = {},
): AgentEventEnvelope => ({
  channel: "agent.event",
  kind,
  layer: "progress",
  phase: "model",
  sequence,
  timestamp: "2026-10-29T00:00:00Z",
  sessionId: "session",
  requestId: "request",
  step: 1,
  data,
});

test("compact observations paginate a stable SQLite snapshot and survive reopening without copying tool bodies", async () => {
  const root = createTemporaryDirectory("senera-insights");
  const database = path.join(root, "sessions.db");
  let repository = new SqliteSessionRepository(database);
  try {
    let store = new AgentSessionStore({ repository });
    store.open("session");
    for (let index = 1; index <= 300; index++)
      store.persistRunEvent(
        "session",
        event(index, AgentEventKinds.ModelCompleted, {
          messageIndex: index,
          responseModel: "reported-serving-model",
          text: "PRIVATE BODY",
          usage: {
            source: "provider_reported",
            totalTokens: index,
            cost: { currency: "USD", total: 0.01, totalFromProvider: true },
          },
        }),
      );
    store.persistRunEvent(
      "session",
      event(301, AgentEventKinds.ToolCallFailed, {
        index: 0,
        callId: "call",
        toolName: "Read",
        message: "Permission denied",
        arguments: "PRIVATE ARGUMENTS",
        result: "PRIVATE RESULT",
        durationMs: 20,
      }),
    );
    store.persistRunEvent(
      "session",
      event(302, AgentEventKinds.ToolCallStarted, {
        index: 1,
        callId: "spawn",
        toolName: "subagent",
        origin: {
          kind: "system",
          name: "Agents",
          presentation: {
            category: "agent-spawn",
            icon: "delegation",
            activity: { action: { "zh-CN": "启动子代理", "en-US": "Start subagent" }, argumentPath: "/description" },
          },
        },
        arguments: { description: "调查上传问题".repeat(100), prompt: "PRIVATE PROMPT", extra: "PRIVATE ARGUMENTS" },
      }),
    );
    store.persistRunEvent("session", event(303, AgentEventKinds.ToolCallResultDetail, { value: "PRIVATE RESULT" }));
    repository.close();
    repository = new SqliteSessionRepository(database);
    store = new AgentSessionStore({ repository });
    const first = await readAgentSessionInsights(store, { sessionId: "session" });
    expect(first?.events).toHaveLength(128);
    expect(first?.nextCursor).toBeDefined();
    store.persistRunEvent("session", event(304));
    const events = [...first!.events];
    let after = first!.nextCursor;
    while (after !== undefined) {
      const page = await readAgentSessionInsights(store, { sessionId: "session", after, through: first!.through });
      expect(page!.through).toBe(first!.through);
      events.push(...page!.events);
      after = page!.nextCursor;
    }
    expect(events).toHaveLength(302);
    expect(events[0]?.data).toMatchObject({
      responseModel: "reported-serving-model",
      usage: { cost: { totalFromProvider: true } },
    });
    expect(new Set(events.map((item) => item.sequence)).size).toBe(302);
    expect(events.find((item) => item.sequence === 301)?.data).toMatchObject({
      message: "Permission denied",
      durationMs: 20,
    });
    const action = events.at(-1)!.data as {
      origin: { presentation: { icon: string } };
      arguments: { description: string };
    };
    expect(action.origin.presentation.icon).toBe("delegation");
    expect(action.arguments.description).toMatch(/^调查上传问题/u);
    expect(Buffer.byteLength(JSON.stringify(action.arguments))).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(events)).not.toContain("PRIVATE");
    expect(await readAgentSessionInsights(store, { sessionId: "missing" })).toBeUndefined();
  } finally {
    repository.close();
    removeDirectory(root);
  }
});

test("insights HTTP validates cursors and applies credentialed CORS on the actual route", async () => {
  const store = new AgentSessionStore();
  store.open("session");
  const api = new AgentSessionInsightsHttpApi({
    read: (input) => readAgentSessionInsights(store, input),
    isOriginAllowed: (origin) => origin === "http://frontend.test",
  });
  const server = http.createServer((request, response) => {
    void api.handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  const base = `http://127.0.0.1:${address.port}/api/session/insights`;
  try {
    const response = await fetch(`${base}?sessionId=session`, { headers: { Origin: "http://frontend.test" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(await response.json()).toMatchObject({ sessionId: "session", events: [] });
    for (const value of ["", "-1", "1.5", "NaN"])
      expect((await fetch(`${base}?sessionId=session&after=${value}`)).status).toBe(400);
    expect((await fetch(`${base}?sessionId=session`, { headers: { Origin: "http://unknown.test" } })).status).toBe(403);
    expect((await fetch(`${base}?sessionId=missing`)).status).toBe(404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
