import type { AgentPersonaPreset } from "../Presets/AgentPresetTypes.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import type { AgentSelfPresetSummary, AgentSelfServicePort } from "./AgentSelfServiceTypes.js";
import { projectAgentSelfRedacted } from "./AgentSelfRedaction.js";

export async function listAgentSelfPresets(port: AgentSelfServicePort): Promise<{
  readonly active: string | null;
  readonly presets: readonly AgentSelfPresetSummary[];
  readonly text: string;
}> {
  const manager = port.presets.manager();
  const snapshot = await manager.snapshot();
  const active = snapshot.activePresetName;
  const presets: AgentSelfPresetSummary[] = (snapshot.presets ?? []).map((item) => ({
    name: item.name,
    title: item.title,
    active: item.active,
    sizeBytes: item.sizeBytes,
    updatedAt: item.updatedAt,
  }));
  const lines = presets.map(
    (preset) => `${preset.active ? "●" : "○"} ${displayPresetName(preset.name)} — ${preset.title}`,
  );
  return {
    active,
    presets,
    text: [`Active preset: ${displayPresetName(active)}`, ...lines].join("\n"),
  };
}

export async function showAgentSelfPreset(
  port: AgentSelfServicePort,
  name: string,
): Promise<{ readonly name: string; readonly card?: unknown; readonly text: string }> {
  const manager = port.presets.manager();
  const snapshot = await manager.snapshot();
  const fileName = await resolveAgentSelfPresetFileName(port, name);
  const item = (snapshot.presets ?? []).find((candidate) => candidate.name === fileName);
  if (!item) throw new Error(`Preset not found: ${name}`);
  const card = item.card ? projectAgentSelfPresetCard(item.card) : undefined;
  return {
    name: item.name,
    card: card ? projectAgentSelfRedacted(card) : undefined,
    text: [
      `${displayPresetName(item.name)} — ${item.title}${item.active ? " (active)" : ""}`,
      ...(card
        ? [
            `examples: ${card.examples}`,
            `lore entries: ${card.lore}`,
            `language style: ${card.languageStyle || "(default)"}`,
            `core persona: ${card.corePersona || "(empty)"}`,
          ]
        : ["(no persona card)"]),
    ].join("\n"),
  };
}

export async function activateAgentSelfPreset(
  port: AgentSelfServicePort,
  name: string | null,
): Promise<{ readonly active: string | null }> {
  const manager = port.presets.manager();
  const requested = name === null ? null : await resolveAgentSelfPresetFileName(port, name);
  const snapshot = await manager.setActive({ name: requested });
  return { active: snapshot.activePresetName };
}

/**
 * Resolves a user-friendly preset name ("tester") to the stored file name
 * ("tester.json"). The preset repository records file names including the
 * `.json` extension while the activation state must use the same identity;
 * matching both spellings keeps the command surface ergonomic and durable.
 */
export async function resolveAgentSelfPresetFileName(port: AgentSelfServicePort, name: string): Promise<string> {
  const manager = port.presets.manager();
  const snapshot = await manager.snapshot();
  const match = (snapshot.presets ?? []).find(
    (candidate) => candidate.name === name || candidate.name === `${name}.json`,
  );
  if (!match) throw new Error(`Preset not found: ${name}`);
  return match.name;
}

function projectAgentSelfPresetCard(card: {
  title: string;
  corePersona: string;
  languageStyle: string;
  examples: unknown[];
  lore: unknown[];
}): { title: string; corePersona: string; languageStyle: string; examples: number; lore: number } {
  return {
    title: card.title,
    corePersona: summarizePresetText(card.corePersona, 600),
    languageStyle: card.languageStyle,
    examples: card.examples.length,
    lore: card.lore.length,
  };
}

function displayPresetName(name: string | null): string {
  if (!name) return "(none)";
  return name.toLocaleLowerCase().endsWith(".json") ? name.slice(0, -5) : name;
}

export async function saveAgentSelfPreset(
  port: AgentSelfServicePort,
  input: { readonly name: string; readonly content: string },
): Promise<{ readonly name: string; readonly created: boolean }> {
  const manager = port.presets.manager();
  const previous = await manager.snapshot();
  const existed = (previous.presets ?? []).some((preset) => preset.name === input.name);
  const card = parseAgentSelfPresetCard(input.content);
  await manager.save({
    requestId: createAgentSelfPresetRequestId(),
    name: input.name,
    card,
  });
  return { name: input.name, created: !existed };
}

function parseAgentSelfPresetCard(content: string): AgentPersonaPreset {
  const value = parseJsonText(content, "Preset card");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Preset content must be a JSON persona card object.");
  }
  // The preset parser performs the full schema validation and throws
  // localized diagnostics for invalid cards.
  return value as AgentPersonaPreset;
}

function createAgentSelfPresetRequestId(): string {
  return `self-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizePresetText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}
