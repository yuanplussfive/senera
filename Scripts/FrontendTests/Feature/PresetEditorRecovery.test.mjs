import { describe, expect, it } from "vitest";
import {
  createPersonaPresetCard,
  normalizePersonaPresetCard,
  validatePersonaPresetCard,
} from "../../../Frontend/src/features/chat/presetPanelUtils.ts";

describe("persona preset card helpers", () => {
  it("creates cards with stable structured defaults", () => {
    expect(createPersonaPresetCard("Mika")).toEqual({
      schemaVersion: "senera.persona/v2",
      title: "Mika",
      corePersona: "",
      languageStyle: "",
      worldPackageIds: [],
      examples: [],
      lore: [],
    });
  });

  it("validates incomplete examples and lore without requiring raw JSON", () => {
    const card = createPersonaPresetCard("Mika");
    card.examples.push({ id: "example", situation: "", reply: "hello" });
    expect(validatePersonaPresetCard(card)).toBe("每个示例都需要场景和回复。");

    card.examples = [];
    card.lore.push({ id: "lore", title: "", keywords: [], content: "", enabled: true });
    expect(validatePersonaPresetCard(card)).toBe("每个按需设定都需要标题、关键词和内容。");
    expect(normalizePersonaPresetCard(card)).toMatchObject({ title: "Mika", schemaVersion: "senera.persona/v2" });
  });
});
