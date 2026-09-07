import type { ModelsDevModelMetadata } from "../../api/eventTypes";
import type { ModelCapabilitiesDraft } from "./modelConfigTypes";

/** Capability keys surfaced from models.dev metadata, in display order. */
export type ModelsDevCapabilityKey =
  "toolCalling" | "reasoning" | "structuredOutput" | "vision" | "imageOutput" | "audio" | "attachment";

const AUDIO_MODALITIES = ["audio", "voice", "speech"] as const;

export function readModelsDevCapabilityKeys(metadata: ModelsDevModelMetadata | undefined): ModelsDevCapabilityKey[] {
  if (!metadata) return [];
  const keys: ModelsDevCapabilityKey[] = [];
  if (metadata.toolCall) keys.push("toolCalling");
  if (metadata.reasoning) keys.push("reasoning");
  if (metadata.structuredOutput) keys.push("structuredOutput");
  if (metadata.attachment) keys.push("attachment");
  if (hasModality(metadata.inputModalities, "image")) keys.push("vision");
  if (hasModality(metadata.outputModalities, "image")) keys.push("imageOutput");
  if (metadata.inputModalities.some(isAudioModality) || metadata.outputModalities.some(isAudioModality)) {
    keys.push("audio");
  }
  return keys;
}

/**
 * Projects models.dev facts onto the local capability flags. Only explicit
 * values are applied; modality arrays are ignored while empty so that
 * providers without modality data keep the local defaults.
 */
export function readModelsDevCapabilities(
  metadata: ModelsDevModelMetadata | undefined,
): Partial<ModelCapabilitiesDraft> {
  if (!metadata) return {};
  const capabilities: Partial<ModelCapabilitiesDraft> = {};
  if (metadata.toolCall !== undefined) capabilities.ToolCalling = metadata.toolCall;
  if (metadata.reasoning !== undefined) capabilities.Reasoning = metadata.reasoning;
  if (metadata.inputModalities.length > 0) capabilities.Vision = hasModality(metadata.inputModalities, "image");
  if (metadata.outputModalities.length > 0) {
    capabilities.Chat = hasModality(metadata.outputModalities, "text");
    capabilities.ImageOutput = hasModality(metadata.outputModalities, "image");
    capabilities.Embedding = hasModality(metadata.outputModalities, "embedding");
  }
  return capabilities;
}

function hasModality(modalities: readonly string[], value: string): boolean {
  return modalities.some((modality) => modality.trim().toLowerCase() === value);
}

function isAudioModality(modality: string): boolean {
  const normalized = modality.trim().toLowerCase();
  return (AUDIO_MODALITIES as readonly string[]).includes(normalized);
}
