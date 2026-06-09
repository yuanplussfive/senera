import { describe, expect, it } from "vitest";
import { readModelProviderIconSrc } from "./ModelProviderIcon";

describe("readModelProviderIconSrc", () => {
  it("preserves absolute icon paths", () => {
    expect(readModelProviderIconSrc("/custom/icon.svg")).toBe("/custom/icon.svg");
  });

  it("normalizes configured icon names into model-provider asset paths", () => {
    expect(readModelProviderIconSrc("openai")).toBe("/icons/model-providers/openai.svg");
    expect(readModelProviderIconSrc("anthropic.svg")).toBe("/icons/model-providers/anthropic.svg");
  });
});
