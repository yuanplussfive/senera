import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import {
  AgentToolObservationPriorityTiers,
  AgentToolObservationProjectionSchemaVersion,
  type AgentToolObservationProjectionManifest,
  type AgentToolObservationStructuralLimits,
} from "../Types/AgentToolObservationProjectionTypes.js";

const CompactTextLimits = structuralLimits({
  maxDepth: 1,
  maxArrayItems: 4,
  maxObjectProperties: 8,
  maxStringCharacters: 2_048,
  maxTotalCharacters: 2_048,
  maxNodes: 16,
});

const StandardStructuredLimits = structuralLimits({
  maxDepth: 8,
  maxArrayItems: 32,
  maxObjectProperties: 48,
  maxStringCharacters: 2_048,
  maxTotalCharacters: 12_288,
  maxNodes: 384,
});

export const StandardAgentToolObservationProjection = deepFreeze({
  schemaVersion: AgentToolObservationProjectionSchemaVersion,
  maxTokens: 2_048,
  maxOmissions: 24,
  artifactFallback: { strategy: "reference", requiredWhenTruncated: true },
  sources: [
    source("headline", "text", "essential", 128, CompactTextLimits),
    source("summary", "text", "high", 512, CompactTextLimits),
    source("retrieval", "json", "high", 256, StandardStructuredLimits),
    source("result", "auto", "normal", 1_024, StandardStructuredLimits),
    source("evidence", "orderedArray", "normal", 512, StandardStructuredLimits),
    source("delta", "orderedArray", "normal", 384, StandardStructuredLimits),
    source("limitations", "orderedArray", "low", 192, StandardStructuredLimits),
  ],
} satisfies AgentToolObservationProjectionManifest);

export const AgentToolObservationPriorityOrder = [
  AgentToolObservationPriorityTiers.Essential,
  AgentToolObservationPriorityTiers.High,
  AgentToolObservationPriorityTiers.Normal,
  AgentToolObservationPriorityTiers.Low,
] as const;

function source(
  sourceName: AgentToolObservationProjectionManifest["sources"][number]["source"],
  mode: AgentToolObservationProjectionManifest["sources"][number]["mode"],
  priority: AgentToolObservationProjectionManifest["sources"][number]["priority"],
  maxTokens: number,
  limits: AgentToolObservationStructuralLimits,
) {
  return { source: sourceName, mode, priority, maxTokens, limits };
}

function structuralLimits(limits: AgentToolObservationStructuralLimits): AgentToolObservationStructuralLimits {
  return limits;
}
