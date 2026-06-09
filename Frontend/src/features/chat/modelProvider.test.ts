import { describe, expect, it } from "vitest";
import type { ModelProviderListItem, ModelProviderMetadata } from "../../api/eventTypes";
import { formatModelProviderName, readSelectedModelProvider } from "./modelProvider";

const providers = [
  {
    id: "fast",
    title: "Fast Model",
    icon: "spark",
    kind: "openai",
    endpoint: "fast",
    baseUrl: "https://example.test",
    model: "fast-1",
    isDefault: false,
  },
  {
    id: "default",
    title: "Default Model",
    kind: "openai",
    endpoint: "default",
    baseUrl: "https://example.test",
    model: "default-1",
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

describe("formatModelProviderName", () => {
  it("joins distinct title and model names", () => {
    const provider = {
      id: "senera",
      title: "Senera",
      kind: "openai",
      endpoint: "senera",
      baseUrl: "https://example.test",
      model: "senera-large",
    } satisfies ModelProviderMetadata;

    expect(formatModelProviderName(provider)).toBe("Senera · senera-large");
  });

  it("deduplicates title and model names after normalization", () => {
    const provider = {
      id: "gpt",
      title: "GPT 4.1",
      kind: "openai",
      endpoint: "gpt",
      baseUrl: "https://example.test",
      model: "gpt-4-1",
    } satisfies ModelProviderMetadata;

    expect(formatModelProviderName(provider)).toBe("GPT 4.1");
  });

  it("uses the assistant fallback when no provider name is available", () => {
    expect(formatModelProviderName({
      id: "unknown",
      kind: "openai",
      endpoint: "unknown",
      baseUrl: "https://example.test",
      model: "",
    })).toBe("AI 助手");
    expect(formatModelProviderName()).toBe("AI 助手");
  });
});
