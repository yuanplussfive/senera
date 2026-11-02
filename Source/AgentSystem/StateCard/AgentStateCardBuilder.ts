import { uniqueStrings } from "../Core/AgentCollections.js";
import { Temporal } from "@js-temporal/polyfill";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import {
  AgentStateCardHistoryLayers,
  AgentStateCardSchemaVersion,
  AgentStateCardTopicRelations,
  type AgentStateCard,
  type AgentStateCardBuildInput,
  type AgentStateCardHistoryLayer,
  type AgentStateCardLimits,
  type AgentStateCardScene,
  type AgentStateCardToolReference,
} from "./AgentStateCardTypes.js";

export const DefaultAgentStateCardLimits: Readonly<AgentStateCardLimits> = Object.freeze({
  prevRequests: 3,
  tools: 5,
  artifacts: 5,
  skills: 5,
  requestChars: 40,
});

export function buildAgentStateCard(input: AgentStateCardBuildInput): AgentStateCard {
  const limits: AgentStateCardLimits = { ...DefaultAgentStateCardLimits, ...input.limits };
  const currentRequest = input.currentRequest;
  const now = input.now ?? new Date();

  const fineTurns = input.history.filter((turn) => turn.layer === AgentStateCardHistoryLayers.Fine);
  const compaction = input.compaction;

  const fineRequests = uniqueStrings(fineTurns.map((turn) => truncate(turn.request, limits.requestChars)));
  const fineTools = dedupeTools(fineTurns.flatMap((turn) => turn.tools));
  const fineArtifacts = uniqueStrings(fineTurns.flatMap((turn) => turn.artifacts));

  const coarseRequests = compaction?.summary ? [truncate(compaction.summary, limits.requestChars)] : [];
  const coarseTools = compaction?.toolIndex ? dedupeTools(compaction.toolIndex) : [];
  const coarseArtifacts = compaction?.artifacts ? uniqueStrings(compaction.artifacts) : [];

  const usesCoarseHistory = fineRequests.length === 0 && coarseRequests.length > 0;
  const prevRequests = (usesCoarseHistory ? coarseRequests : fineRequests).slice(-limits.prevRequests);
  const lastTools = (fineTools.length > 0 ? fineTools : coarseTools).slice(-limits.tools);
  const artifacts = (fineArtifacts.length > 0 ? fineArtifacts : coarseArtifacts).slice(-limits.artifacts);
  const failedTools = lastTools.filter((tool) => tool.status === "failure").slice(-limits.tools);
  const activeSkills = uniqueStrings(input.activeSkills ?? []).slice(-limits.skills);

  const historyLayer: AgentStateCardHistoryLayer =
    usesCoarseHistory || (compaction !== undefined && fineTurns.length === 0)
      ? AgentStateCardHistoryLayers.Coarse
      : AgentStateCardHistoryLayers.Fine;

  const card: AgentStateCard = {
    version: AgentStateCardSchemaVersion,
    turnIndex: input.turnIndex ?? input.history.length,
    scene: projectScene(now),
    topicRelation: AgentStateCardTopicRelations.NewTopic,
    standaloneRequest: currentRequest,
    prevRequests,
    lastTools,
    failedTools,
    artifacts,
    activeSkills,
    historyLayer,
    compactionDepth: compaction?.depth ?? 0,
  };
  return card;
}

function projectScene(now: Date): AgentStateCardScene {
  const time = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(DefaultAgentTimeZone);
  return { time: time.toString(), timeZone: time.timeZoneId };
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (max <= 0) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function dedupeTools(references: readonly AgentStateCardToolReference[]): AgentStateCardToolReference[] {
  const byName = new Map<string, AgentStateCardToolReference>();
  for (const reference of references) {
    if (!reference.name) continue;
    byName.set(reference.name, reference);
  }
  return [...byName.values()];
}
