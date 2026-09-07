import { expect, test } from "vitest";

const { inferModelProviderEndpointIcon, inferModelProviderIcon } =
  await import("../../../Frontend/src/features/chat/ModelProviderIcon.tsx");
const { inferModelCatalogCapabilities, inferModelCatalogGroup, inferModelCatalogProvider } =
  await import("../../../Frontend/src/features/chat/modelCatalogRules.ts");
const { readModelCapabilities } = await import("../../../Frontend/src/features/chat/modelConfigData.ts");

test("model catalogue resolves provider and model-family icons without a runtime icon dependency", () => {
  expect(inferModelProviderIcon("claude-sonnet-4", false)).toBe("anthropic");
  expect(inferModelProviderIcon("qwen3-reranker-0.6b", false)).toBe("qwen");
  expect(inferModelProviderIcon("grok-3-mini", false)).toBe("grok");
  expect(inferModelProviderEndpointIcon("xai-grok", false)).toBe("xai");
  expect(inferModelProviderEndpointIcon("openrouter-main", false)).toBe("openrouter");
});

test("model catalogue groups known families and provider-prefixed names", () => {
  expect(inferModelCatalogGroup("bge-m3", "custom")).toMatchObject({ id: "baai", icon: "baai" });
  expect(inferModelCatalogGroup("grok-3", "openai")).toMatchObject({ id: "xai", icon: "grok" });
  expect(inferModelCatalogGroup("unknown-model", "siliconflow-main")).toMatchObject({
    id: "siliconcloud",
    icon: "siliconcloud",
  });
});

test("model catalogue resolves labs providers before parent-provider aliases", () => {
  expect(inferModelCatalogProvider("openai-labs")).toMatchObject({ id: "labs", icon: "labs" });
  expect(inferModelCatalogProvider("google-labs")).toMatchObject({ id: "labs" });
  expect(inferModelCatalogGroup(undefined, "openai-labs")).toMatchObject({ id: "labs", icon: "labs" });
  expect(inferModelProviderIcon("openai-labs", false)).toBe("labs");
});

test("model capability inference recognizes embedding, rerank, and multimodal models", () => {
  expect(inferModelCatalogCapabilities("text-embedding-3-large", "openai")).toMatchObject({
    Chat: false,
    Embedding: true,
  });
  expect(inferModelCatalogCapabilities("qwen3-reranker-0.6b", "qwen")).toMatchObject({
    Chat: false,
    Rerank: true,
  });
  const rerankCapabilities = inferModelCatalogCapabilities("bge-reranker-v2-m3", "custom");
  expect(rerankCapabilities).toMatchObject({ Chat: false, Rerank: true });
  expect(rerankCapabilities).not.toHaveProperty("Embedding");
  expect(inferModelCatalogCapabilities("gemini-2.5-pro", "google")).toMatchObject({
    Chat: true,
    Vision: true,
  });
});

test("explicit model capability flags remain authoritative over catalogue hints", () => {
  expect(
    readModelCapabilities(
      {
        Id: "custom/text-embedding",
        ProviderId: "custom",
        Endpoint: "chat",
        Model: "text-embedding-3-large",
        Capabilities: { Chat: true, Embedding: false },
      },
      {},
    ),
  ).toMatchObject({ Chat: true, Embedding: false });
});
