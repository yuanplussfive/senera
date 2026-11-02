import { describe, expect, test, vi } from "vitest";
import {
  AgentPiDiagnosticSources,
  createAgentPiDiagnosticEvent,
  emitAgentPiDiagnostic,
  createAgentPiDiagnosticLoggerForDetail,
} from "../../../Source/AgentSystem/Pi/AgentPiDiagnostics.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";

describe("Pi diagnostics", () => {
  test("cache and timing telemetry stay informational while provider errors remain warnings", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), tree: vi.fn() };
    const sink = createAgentPiDiagnosticLoggerForDetail(logger as unknown as AgentLogger, "compact")!;
    for (const name of ["prompt_cache", "model_timing", "provider_error"]) {
      await sink(createAgentPiDiagnosticEvent({ source: AgentPiDiagnosticSources.Provider, name }));
    }
    expect(logger.info.mock.calls.map(([name]) => name)).toEqual([
      "pi.provider.prompt_cache",
      "pi.provider.model_timing",
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toBe("pi.provider.provider_error");
  });
  test("preserves timing and usage metrics while redacting authentication tokens", () => {
    const event = createAgentPiDiagnosticEvent({
      context: { requestId: "request-a", step: 1 },
      source: AgentPiDiagnosticSources.Provider,
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

  test("treats diagnostic sink failures as observational", async () => {
    await expect(
      emitAgentPiDiagnostic(
        () => {
          throw new Error("sink failed");
        },
        {
          source: AgentPiDiagnosticSources.Provider,
          name: "provider_failure",
          details: { status: 503 },
        },
      ),
    ).resolves.toBeUndefined();
  });
});
