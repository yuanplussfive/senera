import { describe, expect, it } from "vitest";
import {
  copyModelRuntimeTemplate,
  groupProviderModelRows,
  normalizeModelProviderDraft,
  readProviderModelOwnedBy,
  readProviderModelRows,
} from "../../../Frontend/src/features/chat/modelConfigData.ts";

function modelsDev(providerId) {
  return {
    id: "model",
    sourceModelId: "model",
    providerId,
    inputModalities: [],
    outputModalities: [],
  };
}

describe("model configuration helpers", () => {
  it("keeps configured local rows available when the remote catalog is empty", () => {
    expect(
      readProviderModelRows({
        catalogModels: [],
        configuredOnly: false,
        providerId: "local",
        search: "",
        models: [{ Id: "local/local-only", ProviderId: "local", Endpoint: "chat", Model: "local-only" }],
      }),
    ).toEqual([{ id: "local-only", ownedBy: "local" }]);
  });

  it("preserves configurable retry delays in model drafts", () => {
    expect(
      normalizeModelProviderDraft({
        Id: "local/retry",
        ProviderId: "local",
        Endpoint: "chat",
        Model: "retry",
        RetryBaseDelaySeconds: 0.5,
        RetryMaxDelaySeconds: 12,
        RetryAfterMaxDelaySeconds: 45,
      }),
    ).toMatchObject({
      RetryBaseDelaySeconds: 0.5,
      RetryMaxDelaySeconds: 12,
      RetryAfterMaxDelaySeconds: 45,
    });
  });

  it("copies response and streaming guards into newly configured models", () => {
    expect(
      copyModelRuntimeTemplate({
        MaxResponseBytes: 67_108_864,
        MaxSseEventBytes: 8_388_608,
        MaxSseEvents: 100_000,
      }),
    ).toEqual({
      MaxResponseBytes: 67_108_864,
      MaxSseEventBytes: 8_388_608,
      MaxSseEvents: 100_000,
    });
  });
});

describe("provider model owned-by hints", () => {
  it("prefers the models.dev provider id over the discovery owned_by value", () => {
    expect(readProviderModelOwnedBy({ ownedBy: "anthropic", modelsDev: modelsDev("openai-labs") })).toBe("openai-labs");
  });

  it("falls back to the discovery owned_by value when the models.dev provider id is absent", () => {
    expect(readProviderModelOwnedBy({ ownedBy: "anthropic" })).toBe("anthropic");
    expect(readProviderModelOwnedBy({ modelsDev: modelsDev("openai-labs") })).toBe("openai-labs");
    expect(readProviderModelOwnedBy({})).toBe("");
  });
});

describe("provider model grouping", () => {
  it("groups labs models by the models.dev provider id instead of the model-name rule", () => {
    const groups = groupProviderModelRows([{ id: "gpt-oss-120b", modelsDev: modelsDev("openai-labs") }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "labs", label: "Labs", icon: "labs" });
    expect(groups[0].rows.map((row) => row.id)).toEqual(["gpt-oss-120b"]);
  });

  it("keeps model-name rules authoritative when the models.dev provider is absent", () => {
    const groups = groupProviderModelRows([{ id: "grok-3", ownedBy: "openai" }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "xai", icon: "grok" });
  });

  it("falls back to an unknown group without an openai icon for unresolved providers", () => {
    const groups = groupProviderModelRows([{ id: "odd-model", modelsDev: modelsDev("not-a-known-provider") }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "other", icon: "unknown" });
    expect(groups[0].icon).not.toBe("openai");
  });
});
