import { describe, expect, it } from "vitest";
import { EventKinds, EventLayers, EventPhases } from "../../../Frontend/src/api/eventTypes.ts";
import { resolveConfigSettingsEvent } from "../../../Frontend/src/app/useConfigSettingsCommands.ts";
function event(kind, data) {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Snapshot,
    phase: EventPhases.Config,
    sequence: 1,
    timestamp: "2026-07-03T00:00:00.000Z",
    data,
  };
}
describe("resolveConfigSettingsEvent", () => {
  it("resolves pending config update snapshots as success", () => {
    expect(
      resolveConfigSettingsEvent(
        event(EventKinds.ConfigSnapshot, {
          path: "Config.toml",
          version: 2,
          value: {},
          source: "sqlite",
          diagnostics: [],
          form: { version: 1, sections: [] },
          operation: {
            kind: "config_update",
            requestId: "req-1",
          },
        }),
        new Set(["req-1"]),
      ),
    ).toEqual({
      kind: "config_update_success",
      requestId: "req-1",
    });
  });
  it("ignores non-pending config snapshots", () => {
    expect(
      resolveConfigSettingsEvent(
        event(EventKinds.ConfigSnapshot, {
          path: "Config.toml",
          version: 2,
          value: {},
          source: "sqlite",
          diagnostics: [],
          form: { version: 1, sections: [] },
        }),
        new Set(["req-1"]),
      ),
    ).toBeNull();
  });
  it("resolves config update failures before plugin fallback handles config.failed", () => {
    expect(
      resolveConfigSettingsEvent(
        event(EventKinds.ConfigFailed, {
          configPath: "Config.toml",
          message: "invalid config",
          operation: {
            kind: "config_update",
            requestId: "req-2",
          },
        }),
        new Set(["req-2"]),
      ),
    ).toEqual({
      kind: "config_update_failed",
      requestId: "req-2",
      message: "invalid config",
    });
  });
  it("resolves provider model snapshots and failures as loading completion", () => {
    expect(
      resolveConfigSettingsEvent(
        event(EventKinds.ProviderModelsSnapshot, {
          providerId: "openai",
          baseUrl: "https://api.example.test/v1",
          models: [],
          fetchedAt: "2026-07-03T00:00:00.000Z",
          source: "network",
        }),
        new Set(),
      ),
    ).toEqual({
      kind: "provider_models_finished",
      providerId: "openai",
    });
    expect(
      resolveConfigSettingsEvent(
        event(EventKinds.ProviderModelsFailed, {
          providerId: "openai",
          message: "network failed",
        }),
        new Set(),
      ),
    ).toEqual({
      kind: "provider_models_finished",
      providerId: "openai",
      message: "network failed",
    });
  });
});
