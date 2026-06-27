import { describe, expect, it } from "vitest";
import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import {
  formatModelProviderName,
  readChatModelProviders,
  readSelectedModelProvider,
} from "./modelProvider";

const providers = [
  {
    id: "fast",
    icon: "spark",
    kind: "openai",
    endpoint: "fast",
    baseUrl: "https://example.test",
    model: "fast-1",
    capabilities: { Chat: true },
    isDefault: false,
  },
  {
    id: "default",
    kind: "openai",
    endpoint: "default",
    baseUrl: "https://example.test",
    model: "default-1",
    capabilities: { Chat: true },
    isDefault: true,
  },
] satisfies ModelProviderListItem[];

describe("readSelectedModelProvider", () => {
  it("returns the selected provider when the id is available", () => {
    expect(readSelectedModelProvider(providers, "fast")?.id).toBe("fast");
  });

  it("falls back to the default provider when selected id is missing", () => {
    expect(readSelectedModelProvider(providers, "missing")?.id).toBe("default");
  });
});

describe("readChatModelProviders", () => {
  it("keeps chat-capable models and excludes non-chat models", () => {
    expect(readChatModelProviders([
      ...providers,
      {
        id: "embedding",
        kind: "openai",
        endpoint: "ChatCompletions",
        baseUrl: "https://example.test",
        model: "text-embedding",
        capabilities: { Chat: false, Embedding: true },
        isDefault: false,
      },
    ]).map((provider) => provider.id)).toEqual(["fast", "default"]);
  });

});

describe("formatModelProviderName", () => {
  it("uses the exact model name", () => {
    const provider = {
      id: "senera",
      kind: "openai",
      endpoint: "senera",
      baseUrl: "https://example.test",
      model: "senera-large",
    } satisfies ModelProviderMetadata;

    expect(formatModelProviderName(provider)).toBe("senera-large");
  });

  it("does not replace model ids with prettified titles", () => {
    const provider = {
      id: "gpt",
      kind: "openai",
      endpoint: "gpt",
      baseUrl: "https://example.test",
      model: "gpt-4-1",
    } satisfies ModelProviderMetadata;

    expect(formatModelProviderName(provider)).toBe("gpt-4-1");
  });

  it("uses the assistant fallback when no provider name is available", () => {
    expect(formatModelProviderName({
      id: "unknown",
      kind: "openai",
      endpoint: "unknown",
      baseUrl: "https://example.test",
      model: "",
      capabilities: { Chat: true },
    })).toBe("AI 助手");
    expect(formatModelProviderName()).toBe("AI 助手");
  });
});
