import { describe, expect, test } from "vitest";
import {
  AgentPiDiagnosticSources,
  createAgentPiDiagnosticEvent,
} from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";

describe("Pi diagnostics", () => {
  test("preserves timing and usage metrics while redacting authentication tokens", () => {
    const event = createAgentPiDiagnosticEvent({
      context: { requestId: "request-a", step: 1 },
      source: AgentPiDiagnosticSources.Proxy,
      name: "model_timing",
      details: {
        firstTokenMs: 42,
        inputTokens: 120,
        outputTokens: 30,
        accessToken: "access-secret",
        api_token: "api-secret",
        authorization: "Bearer secret",
        password: "password-secret",
      },
    });

    expect(event.details).toEqual({
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
    expect(event.summary).toContain("firstTokenMs=42");
    expect(event.summary).toContain("accessToken=[redacted]");
  });
});
