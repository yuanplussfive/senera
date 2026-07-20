import { describe, expect, test } from "vitest";
import { createPiTraceEvent } from "../../../Source/AgentSystem/Pi/AgentPiTraceProjector.js";

describe("Pi trace projection", () => {
  test("preserves token timing and usage metrics while redacting authentication tokens", () => {
    const event = createPiTraceEvent({
      requestId: "request-a",
      step: 1,
      source: "proxy",
      eventType: "model_timing",
      payload: {
        firstTokenMs: 42,
        inputTokens: 120,
        outputTokens: 30,
        accessToken: "access-secret",
        api_token: "api-secret",
        authorization: "Bearer secret",
        password: "password-secret",
      },
    });

    const data = event.data as { payload: unknown; summary: string };
    expect(data.payload).toEqual({
      firstTokenMs: 42,
      inputTokens: 120,
      outputTokens: 30,
      accessToken: "[redacted]",
      api_token: "[redacted]",
      authorization: "[redacted]",
      password: "[redacted]",
    });
    expect(JSON.stringify(event)).not.toContain("access-secret");
    expect(JSON.stringify(event)).not.toContain("api-secret");
    expect(data.summary).toContain("firstTokenMs=42");
    expect(data.summary).toContain("accessToken=[redacted]");
  });
});
