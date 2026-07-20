import { describe, expect, it } from "vitest";
import {
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
});
