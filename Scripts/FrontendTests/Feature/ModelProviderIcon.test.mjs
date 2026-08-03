import { expect, test } from "vitest";

const { readModelProviderIconSrc } = await import("../../../Frontend/src/features/chat/ModelProviderIcon.tsx");

test("model provider icon sources stay inside the bundled icon allow-list", () => {
  expect(readModelProviderIconSrc("openai", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc("OPENAI.svg", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc('/evil.svg?x=" onerror="alert(1)', "/app/")).toBe(
    "/app/icons/model-providers/openai.svg",
  );
});
