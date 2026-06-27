import { describe, expect, it } from "vitest";
import {
  inferModelProviderIcon,
  readModelProviderIconSrc,
} from "./ModelProviderIcon";

describe("readModelProviderIconSrc", () => {
  it("preserves absolute icon paths", () => {
    expect(readModelProviderIconSrc("/custom/icon.svg")).toBe("/custom/icon.svg");
  });

  it("normalizes configured icon names into model-provider asset paths", () => {
    expect(readModelProviderIconSrc("openai", "./")).toBe("./icons/model-providers/openai.svg");
    expect(readModelProviderIconSrc("anthropic.svg", "./")).toBe("./icons/model-providers/anthropic.svg");
  });

  it("normalizes base URLs before building icon paths", () => {
    expect(readModelProviderIconSrc("deepseek", "/app")).toBe("/app/icons/model-providers/deepseek.svg");
  });

  it("infers icons from the JSON rule catalog", () => {
    expect(inferModelProviderIcon("gpt-4.1")).toBe("openai");
    expect(inferModelProviderIcon("claude-sonnet-4-5")).toBe("anthropic");
    expect(inferModelProviderIcon("llama-3.3")).toBe("meta");
  });
});
