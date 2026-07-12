import { describe, expect, test } from "vitest";
import { AgentSandboxRuntimeService } from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { agentErrorMessage } from "../../../Source/AgentSystem/I18n/AgentMessageCatalog.js";

describe("sandbox runtime service behavior", () => {
  test("projects localized status snapshots for package, ready, preparing, and fallback states", () => {
    const service = new AgentSandboxRuntimeService({
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      packageAvailable: () => true,
    });

    expect(service.snapshot()).toMatchObject({
      state: "unknown",
      effectiveMode: "fallback",
      message: agentErrorMessage("sandbox.configured.snapshotMessage"),
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.configured.message"),
          recommendation: agentErrorMessage("sandbox.configured.recommendation"),
        }),
      ],
    });

    service.markPreparing();
    expect(service.snapshot()).toMatchObject({
      state: "preparing",
      message: agentErrorMessage("sandbox.preparing.statusMessage"),
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.preparing.message"),
          details: expect.arrayContaining([agentErrorMessage("sandbox.preparing.detail.desktopStartup")]),
        }),
      ],
    });

    service.markReady();
    expect(service.snapshot()).toMatchObject({
      state: "ready",
      effectiveMode: "sandbox",
      message: agentErrorMessage("sandbox.ready.statusMessage"),
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.ready.message"),
          details: expect.arrayContaining([agentErrorMessage("sandbox.ready.detail.networkPolicy")]),
        }),
      ],
    });

    service.markFallback(new Error("runtime unavailable"));
    expect(service.snapshot()).toMatchObject({
      state: "fallback",
      effectiveMode: "fallback",
      message: agentErrorMessage("sandbox.fallback.statusMessage"),
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.fallback.message"),
          details: expect.arrayContaining([
            agentErrorMessage("sandbox.fallback.detail.lastError", { error: "runtime unavailable" }),
          ]),
        }),
      ],
    });
  });

  test("reports localized missing package diagnostics without runtime paths", () => {
    const service = new AgentSandboxRuntimeService({
      packageAvailable: () => false,
    });

    expect(service.snapshot()).toMatchObject({
      state: "fallback",
      supported: false,
      message: agentErrorMessage("sandbox.missing.snapshotMessage"),
      paths: undefined,
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.missing.message"),
          recommendation: agentErrorMessage("sandbox.missing.recommendation"),
        }),
      ],
    });
  });
});
