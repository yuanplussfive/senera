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
  maxNodes: 16,
});

const StandardStructuredLimits = structuralLimits({
  maxDepth: 12,
  maxArrayItems: 256,
  maxObjectProperties: 256,
  maxNodes: 2_048,
});

export const StandardAgentToolObservationProjection = deepFreeze({
  schemaVersion: AgentToolObservationProjectionSchemaVersion,
  maxTokens: 64_000,
  maxOmissions: 64,
  artifactFallback: { strategy: "reference", requiredWhenTruncated: true },
  sources: [
    source("headline", "text", "essential", true, 128, CompactTextLimits),
    source("summary", "text", "high", true, 512, CompactTextLimits),
    source("retrieval", "json", "high", true, 256, StandardStructuredLimits),
    source("result", "auto", "normal", true, 64_000, StandardStructuredLimits),
    source("evidence", "orderedArray", "normal", false, 512, StandardStructuredLimits),
    source("delta", "orderedArray", "normal", false, 384, StandardStructuredLimits),
    source("limitations", "orderedArray", "low", false, 192, StandardStructuredLimits),
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
  requiredForCompletion: boolean,
  maxTokens: number,
  limits: AgentToolObservationStructuralLimits,
) {
  return { source: sourceName, mode, priority, requiredForCompletion, maxTokens, limits };
}

function structuralLimits(limits: AgentToolObservationStructuralLimits): AgentToolObservationStructuralLimits {
  return limits;
}
