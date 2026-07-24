import { describe, expect, test } from "vitest";
import { AgentSandboxRuntimeService } from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { agentErrorMessage } from "../../../Source/AgentSystem/I18n/AgentMessageCatalog.js";

describe("sandbox runtime service behavior", () => {
  test("projects localized status snapshots for package, ready, preparing, and unavailable states", () => {
    const service = new AgentSandboxRuntimeService({
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      packageAvailable: () => true,
    });

    expect(service.snapshot()).toMatchObject({
      state: "unknown",
      effectiveMode: "unavailable",
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

    service.markUnavailable(new Error("runtime unavailable"));
    expect(service.snapshot()).toMatchObject({
      state: "unavailable",
      effectiveMode: "unavailable",
      message: agentErrorMessage("sandbox.unavailable.statusMessage"),
      diagnostics: [
        expect.objectContaining({
          message: agentErrorMessage("sandbox.unavailable.message"),
          details: expect.arrayContaining([
            agentErrorMessage("sandbox.unavailable.detail.lastError", { error: "runtime unavailable" }),
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
      state: "unavailable",
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

  test("reports an explicitly disabled runtime without probing package availability", () => {
    const service = new AgentSandboxRuntimeService({
      configSnapshot: () => ({
        ModelProviders: [],
        SandboxRuntime: { Enabled: false },
      }),
      packageAvailable: () => false,
    });

    expect(service.snapshot()).toMatchObject({
      state: "disabled",
      effectiveMode: "disabled",
      dependencies: { errors: [], warnings: [] },
      diagnostics: [
        expect.objectContaining({
          code: "microsandbox_disabled_by_runtime_configuration",
          message: agentErrorMessage("sandbox.disabled.message"),
        }),
      ],
    });
  });

  test("publishes typed preparation progress without flooding repeated checkpoints", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = new AgentSandboxRuntimeService({
      clock: () => now,
      packageAvailable: () => true,
      progressUpdateIntervalMs: 100,
    });
    const snapshots: ReturnType<typeof service.snapshot>[] = [];
    const unsubscribe = service.subscribe((snapshot) => snapshots.push(snapshot));

    service.markPreparing();
    service.reportProgress({ stage: "loading_runtime" });
    service.reportProgress({ stage: "loading_runtime" });
    now = new Date("2026-01-01T00:00:00.100Z");
    service.reportProgress({
      stage: "warming_image",
      item: "node:22-bookworm-slim",
      completed: 0,
      total: 1,
      downloadedBytes: 512,
      totalBytes: 1024,
    });
    unsubscribe();

    expect(snapshots).toHaveLength(3);
    expect(snapshots.at(-1)).toMatchObject({
      state: "preparing",
      progress: {
        stage: "warming_image",
        item: "node:22-bookworm-slim",
        downloadedBytes: 512,
        totalBytes: 1024,
      },
    });
  });
});
