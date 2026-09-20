import { expect, test } from "vitest";

const { ModelProviderIconNames, readModelProviderIconSrc } =
  await import("../../../Frontend/src/features/chat/ModelProviderIcon.tsx");

test("model provider icon choices are unique", () => {
  expect(new Set(ModelProviderIconNames).size).toBe(ModelProviderIconNames.length);
});

test("model provider icon sources stay inside the bundled icon allow-list", () => {
  expect(readModelProviderIconSrc("openai", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc("OPENAI.svg", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc('/evil.svg?x=" onerror="alert(1)', "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
  expect(readModelProviderIconSrc("https://cdn.example.test/provider.svg", "/app/")).toBe(
    "https://cdn.example.test/provider.svg",
  );
  expect(readModelProviderIconSrc("data:image/png;base64,aW1hZ2U=", "/app/")).toBe("data:image/png;base64,aW1hZ2U=");
  expect(readModelProviderIconSrc("data:image/svg+xml;base64,PHN2Zy8+", "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
  expect(readModelProviderIconSrc("javascript:alert(1)", "/app/")).toBe("/app/icons/model-providers/sparkles.svg");
  expect(readModelProviderIconSrc("//cdn.example.test/provider.svg", "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
});
