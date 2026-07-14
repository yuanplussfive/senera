import { describe, expect, it } from "vitest";
import {
  applyModelProvidersDraft,
  normalizeModelProviderDraft,
  filterRemoteModelPickerRows,
  readProviderModelRows,
  remoteModelCategories,
  remoteModelCategoryMatches,
} from "../../../Frontend/src/features/chat/modelConfigData.ts";
describe("remote model picker helpers", () => {
  const rows = [
    { id: "gpt-4.1", ownedBy: "openai" },
    { id: "gpt-4o-vision", ownedBy: "openai" },
    { id: "deepseek-r1", ownedBy: "deepseek" },
    { id: "text-embedding-3-small", ownedBy: "openai" },
    { id: "bge-reranker-v2-m3", ownedBy: "baai" },
    { id: "tool-agent-function", ownedBy: "example" },
    { id: "web-search-online", ownedBy: "example" },
    { id: "free-chat", ownedBy: "example" },
  ];
  it("keeps the product category order stable", () => {
    expect(remoteModelCategories.map((category) => category.label)).toEqual([
      "全部",
      "推理",
      "视觉",
      "联网",
      "免费",
      "嵌入",
      "重排",
      "工具",
    ]);
  });
  it("matches remote picker categories from model identity without mutating capabilities", () => {
    expect(remoteModelCategoryMatches({ id: "deepseek-r1" }, "reasoning")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "gpt-4o-vision" }, "vision")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "text-embedding-3-small" }, "embedding")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "bge-reranker-v2-m3" }, "rerank")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "tool-agent-function" }, "tools")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "web-search-online" }, "web")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "free-chat" }, "free")).toBe(true);
    expect(remoteModelCategoryMatches({ id: "gpt-4.1" }, "vision")).toBe(false);
  });
  it("combines category filtering with search text", () => {
    expect(
      filterRemoteModelPickerRows({
        rows,
        category: "embedding",
        search: "small",
      }).map((row) => row.id),
    ).toEqual(["text-embedding-3-small"]);
    expect(
      filterRemoteModelPickerRows({
        rows,
        category: "all",
        search: "openai",
      }).map((row) => row.id),
    ).toEqual(["gpt-4.1", "gpt-4o-vision", "text-embedding-3-small"]);
  });
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
  it("keeps an existing default model when applying model provider drafts", () => {
    expect(
      applyModelProvidersDraft({
        requestedDefaultModelId: "openai/gpt-4.1",
        value: {
          DefaultModelProviderId: "openai/gpt-4.1",
          Unrelated: true,
        },
        models: [
          { Id: "openai/gpt-4.1", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1" },
          { Id: "openai/gpt-4.1-mini", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1-mini" },
        ],
      }),
    ).toMatchObject({
      DefaultModelProviderId: "openai/gpt-4.1",
      Unrelated: true,
      ModelProviders: [
        { Id: "openai/gpt-4.1", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1" },
        { Id: "openai/gpt-4.1-mini", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1-mini" },
      ],
    });
  });
  it("falls back when the requested default model is removed", () => {
    expect(
      applyModelProvidersDraft({
        requestedDefaultModelId: "openai/missing",
        value: {
          DefaultModelProviderId: "openai/missing",
        },
        models: [{ Id: "openai/gpt-4.1-mini", ProviderId: "openai", Endpoint: "chat", Model: "gpt-4.1-mini" }],
      }).DefaultModelProviderId,
    ).toBe("openai/gpt-4.1-mini");
    expect(
      applyModelProvidersDraft({
        requestedDefaultModelId: "openai/missing",
        value: {
          DefaultModelProviderId: "openai/missing",
        },
        models: [],
      }),
    ).not.toHaveProperty("DefaultModelProviderId");
  });
});
