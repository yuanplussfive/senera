import { describe, expect, it } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { resolveConfigEntityMutationEvent } from "../../../Frontend/src/app/configEntityMutation.ts";
import { isProviderEndpointOperationKind } from "../../../Frontend/src/app/providerEndpointMutations.ts";

describe("provider endpoint mutation helpers", () => {
  it("matches endpoint success by command id and operation kind", () => {
    const pending = new Map([["req-upsert", { kind: "provider.endpoint.upsert", entityId: "custom-openai" }]]);

    expect(
      resolveConfigEntityMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ revision: 13, version: 5 }),
          operation: {
            commandId: "req-upsert",
            kind: "provider.endpoint.upsert",
          },
        }),
        pending,
        isProviderEndpointOperationKind,
      ),
    ).toEqual({
      outcome: "success",
      commandId: "req-upsert",
      mutation: { kind: "provider.endpoint.upsert", entityId: "custom-openai" },
    });
  });

  it("preserves backend failure messages for matching endpoint operations", () => {
    const pending = new Map([["req-rename", { kind: "provider.endpoint.rename", entityId: "custom-openai" }]]);

    expect(
      resolveConfigEntityMutationEvent(
        event(EventKinds.ConfigFailed, {
          configPath: "Config.toml",
          message: "stale revision",
          operation: {
            commandId: "req-rename",
            kind: "provider.endpoint.rename",
          },
        }),
        pending,
        isProviderEndpointOperationKind,
      ),
    ).toEqual({
      outcome: "failure",
      commandId: "req-rename",
      message: "stale revision",
      mutation: { kind: "provider.endpoint.rename", entityId: "custom-openai" },
    });
  });

  it("does not mistake model operations or mismatched endpoint kinds for connection success", () => {
    const pending = new Map([["req-endpoint", { kind: "provider.endpoint.delete", entityId: "custom-openai" }]]);

    expect(
      resolveConfigEntityMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ version: 5 }),
          operation: {
            commandId: "req-endpoint",
            kind: "provider.model.upsert",
          },
        }),
        pending,
        isProviderEndpointOperationKind,
      ),
    ).toBeNull();

    expect(
      resolveConfigEntityMutationEvent(
        event(EventKinds.ConfigSnapshot, {
          ...configSnapshot({ version: 5 }),
          operation: {
            commandId: "req-endpoint",
            kind: "provider.endpoint.rename",
          },
        }),
        pending,
        isProviderEndpointOperationKind,
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
