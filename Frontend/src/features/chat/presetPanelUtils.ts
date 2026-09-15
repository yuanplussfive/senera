import type { PersonaPresetCard } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export function createPersonaPresetCard(title = ""): PersonaPresetCard {
  return {
    schemaVersion: "senera.persona/v2",
    title,
    corePersona: "",
    languageStyle: "",
    worldPackageIds: [],
    examples: [],
    lore: [],
  };
}

export function normalizePersonaPresetCard(card: PersonaPresetCard | undefined, title = ""): PersonaPresetCard {
  if (!card) return createPersonaPresetCard(title);
  return {
    schemaVersion: "senera.persona/v2",
    title: card.title,
    corePersona: card.corePersona,
    languageStyle: card.languageStyle,
    worldPackageIds: [...card.worldPackageIds],
    examples: card.examples.map((example) => ({ ...example })),
    lore: card.lore.map((entry) => ({ ...entry, keywords: [...entry.keywords] })),
  };
}

export function validatePersonaPresetCard(card: PersonaPresetCard): string | null {
  if (!card.title.trim()) return frontendMessage("preset.ui.nameRequired");
  if (card.examples.some((example) => !example.situation.trim() || !example.reply.trim())) {
    return frontendMessage("preset.ui.exampleRequired");
  }
  if (
    card.lore.some(
      (entry) =>
        !entry.title.trim() ||
        !entry.content.trim() ||
        entry.keywords.map((keyword) => keyword.trim()).filter(Boolean).length === 0,
    )
  ) {
    return frontendMessage("preset.ui.loreRequired");
  }
  return null;
}

export function presetCardText(card: PersonaPresetCard): string {
  return [
    card.title,
    card.corePersona,
    card.languageStyle,
    ...card.examples.flatMap((example) => [example.situation, example.reply]),
    ...card.lore.flatMap((entry) => [entry.title, ...entry.keywords, entry.content]),
  ].join("\n");
}
