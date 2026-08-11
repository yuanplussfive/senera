import { describe, expect, test } from "vitest";
import { AgentSandboxRuntimeService } from "../../../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { agentErrorMessage } from "../../../Source/AgentSystem/I18n/AgentMessageCatalog.js";

describe("sandbox runtime service behavior", () => {
  test("uses governed host execution on Windows regardless of Docker availability", () => {
    const snapshot = new AgentSandboxRuntimeService({ platform: "win32" }).snapshot();

    expect(snapshot).toMatchObject({
      state: "disabled",
      supported: false,
      effectiveMode: "host",
      effectiveTarget: "Local",
      shellDialect: "powershell",
      availableExecutionTargets: ["Local"],
      localExecution: {
        mode: "windows-governed-local",
        isolation: "host",
        authorization: "opa",
        processOwnership: "windows-job",
      },
      message: agentErrorMessage("sandbox.hostPolicy.statusMessage"),
      diagnostics: [
        expect.objectContaining({
          code: "host_execution_platform_policy",
          message: agentErrorMessage("sandbox.hostPolicy.message"),
        }),
      ],
    });
    expect(snapshot).not.toHaveProperty("provider");
  });

  test("projects localized status snapshots for ready, preparing, and unavailable states", () => {
    const service = new AgentSandboxRuntimeService({
      platform: "linux",
      availability: { kind: "available", provider: "docker-engine" },
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
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

  test("reports Docker Engine support before runtime preparation", () => {
    const service = new AgentSandboxRuntimeService({
      platform: "linux",
      availability: { kind: "available", provider: "docker-engine" },
    });

    expect(service.snapshot()).toMatchObject({
      state: "unknown",
      supported: true,
      message: agentErrorMessage("sandbox.configured.snapshotMessage"),
      paths: undefined,
      diagnostics: [
        expect.objectContaining({
          code: "docker-engine_backend_configured",
        }),
      ],
    });
  });

  test("reports an explicitly disabled runtime", () => {
    const service = new AgentSandboxRuntimeService({
      platform: "linux",
      configSnapshot: () => ({
        ModelProviders: [],
        SandboxRuntime: { Enabled: false },
      }),
    });

    expect(service.snapshot()).toMatchObject({
      state: "disabled",
      effectiveMode: "host",
      effectiveTarget: "Local",
      dependencies: { errors: [], warnings: [] },
      diagnostics: [
        expect.objectContaining({
          code: "docker_disabled_by_runtime_configuration",
          message: agentErrorMessage("sandbox.disabled.message"),
        }),
      ],
    });
  });

  test("publishes typed preparation progress without flooding repeated checkpoints", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const service = new AgentSandboxRuntimeService({
      platform: "linux",
      availability: { kind: "available", provider: "docker-engine" },
      clock: () => now,
      progressUpdateIntervalMs: 100,
    });
    const snapshots: ReturnType<typeof service.snapshot>[] = [];
    const unsubscribe = service.subscribe((snapshot) => snapshots.push(snapshot));

    service.markPreparing();
    service.reportProgress({ stage: "detecting_engine" });
    service.reportProgress({ stage: "detecting_engine" });
    now = new Date("2026-01-01T00:00:00.100Z");
    service.reportProgress({
      stage: "pulling_image",
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
        stage: "pulling_image",
        item: "node:22-bookworm-slim",
        downloadedBytes: 512,
        totalBytes: 1024,
      },
    });
  });

  test("does not expose Local as a fallback when a requested POSIX sandbox is unavailable", () => {
    const snapshot = new AgentSandboxRuntimeService({
      platform: "linux",
      availability: { kind: "disabled", reason: "docker-engine-unavailable" },
    }).snapshot();

    expect(snapshot).toMatchObject({
      state: "unavailable",
      supported: false,
      effectiveMode: "unavailable",
      availableExecutionTargets: [],
      dependencies: {
        warnings: [
          "tools selected for the sandbox boundary cannot run until the configured sandbox runtime is available",
        ],
      },
    });
    expect(snapshot).not.toHaveProperty("effectiveTarget");
    expect(snapshot).not.toHaveProperty("shellDialect");
  });
});
