import { describe, expect, it } from "vitest";
import {
  copyModelRuntimeTemplate,
  normalizeModelProviderDraft,
  readProviderModelRows,
} from "../../../Frontend/src/features/chat/modelConfigData.ts";

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
