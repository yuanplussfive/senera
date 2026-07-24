import { describe, expect, it } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { resolveProviderEndpointMutationEvent } from "../../../Frontend/src/app/providerEndpointMutations.ts";

describe("provider endpoint mutation helpers", () => {
  it("matches endpoint success by command id and operation kind", () => {
    const pending = new Map([["req-upsert", { kind: "provider.endpoint.upsert", providerId: "custom-openai" }]]);

    expect(
      resolveProviderEndpointMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ revision: 13, version: 5 }),
          operation: {
            commandId: "req-upsert",
            kind: "provider.endpoint.upsert",
          },
        }),
        pending,
      ),
    ).toEqual({
      kind: "success",
      operationKind: "provider.endpoint.upsert",
      providerId: "custom-openai",
      commandId: "req-upsert",
    });
  });

  it("preserves backend failure messages for matching endpoint operations", () => {
    const pending = new Map([["req-rename", { kind: "provider.endpoint.rename", providerId: "custom-openai" }]]);

    expect(
      resolveProviderEndpointMutationEvent(
        event(EventKinds.ConfigFailed, {
          configPath: "Config.toml",
          message: "stale revision",
          operation: {
            commandId: "req-rename",
            kind: "provider.endpoint.rename",
          },
        }),
        pending,
      ),
    ).toEqual({
      kind: "failure",
      operationKind: "provider.endpoint.rename",
      providerId: "custom-openai",
      commandId: "req-rename",
      message: "stale revision",
    });
  });

  it("does not mistake model operations or mismatched endpoint kinds for connection success", () => {
    const pending = new Map([["req-endpoint", { kind: "provider.endpoint.delete", providerId: "custom-openai" }]]);

    expect(
      resolveProviderEndpointMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ version: 5 }),
          operation: {
            commandId: "req-endpoint",
            kind: "provider.model.upsert",
          },
        }),
        pending,
      ),
    ).toBeNull();

    expect(
      resolveProviderEndpointMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ version: 5 }),
          operation: {
            commandId: "req-endpoint",
            kind: "provider.endpoint.rename",
          },
        }),
        pending,
      ),
    ).toBeNull();
  });
});

function configSnapshot({ version, revision }) {
  return {
    path: "Config.toml",
    version,
    ...(revision === undefined ? {} : { revision }),
    value: {},
    source: "sqlite",
    diagnostics: [],
    form: { version: 1, sections: [] },
  };
}

function event(kind, data) {
  return {
    channel: "agent.event",
    kind,
    layer: "snapshot",
    phase: "config",
    sequence: 1,
    timestamp: "2026-07-10T00:00:00.000Z",
    data,
  };
}
