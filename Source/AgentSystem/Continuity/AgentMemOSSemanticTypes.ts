import type { MemoryNode, MemoryType } from "@mem-os/sdk";
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { AgentMemoryRetentionSchema } from "./AgentMemoryRetention.js";
import { DefaultAgentTimeZone, formatAgentTimeOffset } from "../Time/AgentTime.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";
import type { AgentMemoryEpisodeRecord, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentStateCard } from "../StateCard/AgentStateCardTypes.js";

/** Tags classify a node. Durable identity and provenance live in metadata. */
export const AgentMemOSTags = {
  semantic: "semantic-memory",
  knowledge: "knowledge",
  fragment: "turn-fragment",
  dailyDigest: "daily-digest",
  monthlyDigest: "monthly-digest",
  toolRouting: "tool-routing",
  stateCard: "state-card",
} as const;

export const AgentMemOSSchemaVersion = defineSeneraProtocol("memory", 2).type;
const SemanticDomain = "semantic";
const ToolRoutingDomain = "tool-routing";
const SemanticScopes = ["workspace", "session", "period"] as const;
type AgentMemOSSemanticScope = (typeof SemanticScopes)[number];

const StringListSchema = z.array(z.string().trim().min(1)).transform((values) => [...new Set(values)].sort());

const CommonMetadataSchema = z
  .object({
    senera_schema: z.literal(AgentMemOSSchemaVersion),
    senera_domain: z.enum([SemanticDomain, ToolRoutingDomain]),
  })
  .passthrough();

const SemanticMetadataSchema = CommonMetadataSchema.extend({
  senera_domain: z.literal(SemanticDomain),
  senera_scope: z.enum(SemanticScopes),
  senera_operation_key: z.string().trim().min(1).optional(),
  senera_episode_uri: z.string().trim().min(1).optional(),
  senera_subject_id: z.string().trim().min(1).optional(),
  senera_task_id: z.string().trim().min(1).optional(),
  senera_retention: AgentMemoryRetentionSchema.optional(),
  senera_source_uris: StringListSchema.optional(),
  senera_source_session_ids: StringListSchema.optional(),
  senera_source_request_ids: StringListSchema.optional(),
  senera_period_granularity: z.enum(["day", "month"]).optional(),
  senera_period_key: z.string().trim().min(1).optional(),
  senera_period_start: z.string().trim().min(1).optional(),
  senera_period_end: z.string().trim().min(1).optional(),
}).superRefine((value, context) => {
  const periodFields = [
    value.senera_period_granularity,
    value.senera_period_key,
    value.senera_period_start,
    value.senera_period_end,
  ];
  if (value.senera_scope === "period" && periodFields.some((field) => field === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Period memory requires complete period metadata." });
  }
  if (value.senera_scope !== "period" && periodFields.some((field) => field !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only period memory may declare period metadata." });
  }
});

const ToolRoutingMetadataSchema = CommonMetadataSchema.extend({
  senera_domain: z.literal(ToolRoutingDomain),
  senera_project_id: z.string().trim().min(1),
  senera_session_id: z.string().trim().min(1),
  senera_request_id: z.string().trim().min(1),
});

export type AgentMemOSSemanticMetadata = z.infer<typeof SemanticMetadataSchema>;
export type AgentMemOSToolRoutingMetadata = z.infer<typeof ToolRoutingMetadataSchema>;

export function readAgentMemOSSemanticMetadata(
  node: Pick<MemoryNode, "metadata">,
): AgentMemOSSemanticMetadata | undefined {
  const parsed = SemanticMetadataSchema.safeParse(node.metadata);
  return parsed.success ? parsed.data : undefined;
}

export function readAgentMemOSToolRoutingMetadata(
  node: Pick<MemoryNode, "metadata">,
): AgentMemOSToolRoutingMetadata | undefined {
  const parsed = ToolRoutingMetadataSchema.safeParse(node.metadata);
  return parsed.success ? parsed.data : undefined;
}

export function isAgentMemOSCurrentSchemaNode(node: Pick<MemoryNode, "metadata">): boolean {
  return CommonMetadataSchema.safeParse(node.metadata).success;
}

/**
 * Converts the retired tag protocol exactly once. This is a data migration,
 * not a query fallback: migrated nodes are subsequently read only through v2
 * metadata. Hashed write tags are deliberately not interpreted as provenance.
 */
export function migrateAgentMemOSLegacySemanticMetadata(node: MemoryNode): AgentMemOSSemanticMetadata | undefined {
  if (!node.tags.includes(AgentMemOSTags.semantic) || readAgentMemOSSemanticMetadata(node)) return undefined;
  const day = readLegacyTag(node.tags, "day:");
  const month = readLegacyTag(node.tags, "month:");
  if (node.tags.includes(AgentMemOSTags.dailyDigest) && day) {
    return createAgentMemOSPeriodMetadata({
      granularity: "day",
      periodKey: day,
      sessionIds: readLegacySessions(node.tags),
      requestIds: [],
      sourceUris: [],
      operationKey: `legacy:${node.id}`,
    });
  }
  if (node.tags.includes(AgentMemOSTags.monthlyDigest) && month) {
    return createAgentMemOSPeriodMetadata({
      granularity: "month",
      periodKey: month,
      sessionIds: readLegacySessions(node.tags),
      requestIds: [],
      sourceUris: [],
      operationKey: `legacy:${node.id}`,
    });
  }
  const scope =
    node.tags.includes(AgentMemOSTags.fragment) ||
    node.type === "context" ||
    node.type === "entity" ||
    node.type === "custom"
      ? "session"
      : "workspace";
  return SemanticMetadataSchema.parse({
    senera_schema: AgentMemOSSchemaVersion,
    senera_domain: SemanticDomain,
    senera_scope: scope,
    senera_operation_key: `legacy:${node.id}`,
    senera_source_session_ids: readLegacySessions(node.tags),
  });
}

export function stripAgentMemOSLegacyProvenanceTags(tags: readonly string[]): string[] {
  return tags.filter(
    (tag) =>
      !tag.startsWith("session:") && !tag.startsWith("write:") && !tag.startsWith("day:") && !tag.startsWith("month:"),
  );
}

function readLegacyTag(tags: readonly string[], prefix: string): string | undefined {
  const values = [...new Set(tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length)))];
  return values.length === 1 && values[0]?.trim() ? values[0]!.trim() : undefined;
}

function readLegacySessions(tags: readonly string[]): string[] {
  return normalizeList(
    tags.flatMap((tag) => {
      if (!tag.startsWith("session:")) return [];
      try {
        const value = decodeURIComponent(tag.slice("session:".length)).trim();
        return value ? [value] : [];
      } catch {
        return [];
      }
    }),
  );
}

export function createAgentMemOSFragmentMetadata(input: {
  readonly episode: AgentMemoryEpisodeRecord;
  readonly sources: readonly AgentMemorySourceRecord[];
  readonly operationKey: string;
}): AgentMemOSSemanticMetadata {
  return createSemanticMetadata({
    scope: "session",
    operationKey: input.operationKey,
    episodeUri: input.episode.uri,
    sourceUris: input.sources.map((source) => source.uri),
    sessionIds: [input.episode.sessionId],
    requestIds: [input.episode.requestId],
  });
}

export function createAgentMemOSKnowledgeMetadata(input: {
  readonly episode: AgentMemoryEpisodeRecord;
  readonly sources: readonly AgentMemorySourceRecord[];
  readonly operationKey: string;
  readonly type: AgentMemOSSemanticMemoryType;
}): AgentMemOSSemanticMetadata {
  return createSemanticMetadata({
    scope: input.type === "context" ? "session" : "workspace",
    operationKey: input.operationKey,
    episodeUri: input.episode.uri,
    sourceUris: input.sources.map((source) => source.uri),
    sessionIds: [input.episode.sessionId],
    requestIds: [input.episode.requestId],
  });
}

export function mergeAgentMemOSKnowledgeMetadata(
  node: Pick<MemoryNode, "metadata">,
  input: {
    readonly episode: AgentMemoryEpisodeRecord;
    readonly sources: readonly AgentMemorySourceRecord[];
    readonly operationKey: string;
    readonly type: AgentMemOSSemanticMemoryType;
  },
): AgentMemOSSemanticMetadata {
  const current = readAgentMemOSSemanticMetadata(node);
  if (!current || current.senera_scope === "period") return createAgentMemOSKnowledgeMetadata(input);
  return createSemanticMetadata({
    scope: input.type === "context" ? "session" : "workspace",
    operationKey: input.operationKey,
    episodeUri: input.episode.uri,
    sourceUris: [...(current.senera_source_uris ?? []), ...input.sources.map((source) => source.uri)],
    sessionIds: [...(current.senera_source_session_ids ?? []), input.episode.sessionId],
    requestIds: [...(current.senera_source_request_ids ?? []), input.episode.requestId],
  });
}

export function createAgentMemOSPeriodMetadata(input: {
  readonly granularity: "day" | "month";
  readonly periodKey: string;
  readonly sessionIds: readonly string[];
  readonly requestIds: readonly string[];
  readonly sourceUris: readonly string[];
  readonly operationKey: string;
}): AgentMemOSSemanticMetadata {
  const date =
    input.granularity === "day"
      ? Temporal.PlainDate.from(input.periodKey)
      : Temporal.PlainYearMonth.from(input.periodKey).toPlainDate({ day: 1 });
  const start = date.toZonedDateTime(DefaultAgentTimeZone).startOfDay();
  const end = input.granularity === "day" ? start.add({ days: 1 }) : start.add({ months: 1 });
  return SemanticMetadataSchema.parse({
    senera_schema: AgentMemOSSchemaVersion,
    senera_domain: SemanticDomain,
    senera_scope: "period",
    senera_operation_key: requireText(input.operationKey, "MemOS period operation key"),
    senera_source_uris: normalizeList(input.sourceUris),
    senera_source_session_ids: normalizeList(input.sessionIds),
    senera_source_request_ids: normalizeList(input.requestIds),
    senera_period_granularity: input.granularity,
    senera_period_key:
      input.granularity === "day"
        ? Temporal.PlainDate.from(input.periodKey).toString()
        : Temporal.PlainYearMonth.from(input.periodKey).toString(),
    senera_period_start: formatAgentTimeOffset(start.toInstant().toString()),
    senera_period_end: formatAgentTimeOffset(end.toInstant().toString()),
  });
}

export function createAgentMemOSToolRoutingMetadata(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly requestId: string;
}): AgentMemOSToolRoutingMetadata {
  return ToolRoutingMetadataSchema.parse({
    senera_schema: AgentMemOSSchemaVersion,
    senera_domain: ToolRoutingDomain,
    senera_project_id: input.projectId,
    senera_session_id: input.sessionId,
    senera_request_id: input.requestId,
  });
}

function createSemanticMetadata(input: {
  readonly scope: Exclude<AgentMemOSSemanticScope, "period">;
  readonly operationKey: string;
  readonly episodeUri: string;
  readonly sourceUris: readonly string[];
  readonly sessionIds: readonly string[];
  readonly requestIds: readonly string[];
}): AgentMemOSSemanticMetadata {
  return SemanticMetadataSchema.parse({
    senera_schema: AgentMemOSSchemaVersion,
    senera_domain: SemanticDomain,
    senera_scope: input.scope,
    senera_operation_key: requireText(input.operationKey, "MemOS operation key"),
    senera_episode_uri: requireText(input.episodeUri, "MemOS episode URI"),
    senera_source_uris: normalizeList(input.sourceUris),
    senera_source_session_ids: normalizeList(input.sessionIds),
    senera_source_request_ids: normalizeList(input.requestIds),
  });
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export const AgentMemOSSummarySchema = z.string().trim().min(1);

export function projectAgentMemOSPeriod(node: MemoryNode):
  | {
      readonly granularity: "day" | "month";
      readonly start: string;
      readonly end: string;
    }
  | undefined {
  const metadata = readAgentMemOSSemanticMetadata(node);
  if (metadata?.senera_scope !== "period") return undefined;
  return {
    granularity: metadata.senera_period_granularity!,
    start: metadata.senera_period_start!,
    end: metadata.senera_period_end!,
  };
}

export function projectAgentMemOSOccurredAt(node: MemoryNode): string {
  const period = projectAgentMemOSPeriod(node);
  if (period) return period.start;
  return formatAgentTimeOffset(Temporal.Instant.fromEpochMilliseconds(node.validFrom ?? node.createdAt).toString());
}

export function agentMemOSRevision(node: MemoryNode): string {
  const period = projectAgentMemOSPeriod(node);
  return sha256HexOfCanonicalJson({
    content: node.content,
    summary: node.summary,
    type: node.type,
    validFrom: node.validFrom,
    validTo: node.validTo,
    metadata: node.metadata,
    period: period
      ? {
          granularity: period.granularity,
          start: Temporal.Instant.from(period.start).toString(),
          end: Temporal.Instant.from(period.end).toString(),
        }
      : undefined,
  });
}

export function agentMemOSDedupeKey(node: MemoryNode): string {
  return `${agentMemOSReference(node.id)}@${agentMemOSRevision(node)}`;
}

export const AgentMemOSSemanticMemoryTypes = ["fact", "preference", "relationship", "context"] as const;
export type AgentMemOSSemanticMemoryType = (typeof AgentMemOSSemanticMemoryTypes)[number];

/** Knowledge types eligible for automatic frozen or dynamic recall. */
export const AgentMemOSAutomaticPromptMemoryTypes = AgentMemOSSemanticMemoryTypes;
export type AgentMemOSAutomaticPromptMemoryType = (typeof AgentMemOSAutomaticPromptMemoryTypes)[number];

export function isAgentMemOSLearningMemoryType(value: MemoryType): value is AgentMemOSSemanticMemoryType {
  return AgentMemOSSemanticMemoryTypes.includes(value as AgentMemOSSemanticMemoryType);
}

/** Only attributed current-schema knowledge enters automatic recall, never raw fragments. */
export function isAgentMemOSAutomaticPromptMemory(
  node: MemoryNode,
): node is MemoryNode & { readonly type: AgentMemOSAutomaticPromptMemoryType } {
  const metadata = readAgentMemOSSemanticMetadata(node);
  return (
    node.tags.includes(AgentMemOSTags.semantic) &&
    node.tags.includes(AgentMemOSTags.knowledge) &&
    (metadata?.senera_scope === "workspace" || metadata?.senera_scope === "session") &&
    AgentMemOSAutomaticPromptMemoryTypes.includes(node.type as AgentMemOSAutomaticPromptMemoryType)
  );
}

export type AgentMemOSMemoryAssessment = import("zod").z.infer<
  typeof import("./AgentMemoryUtilityContract.js").AgentMemoryUtilityAssessmentSchema
>;

export interface AgentMemOSSemanticFragment {
  readonly topic: string;
  readonly summary: string;
  readonly type: AgentMemOSSemanticMemoryType;
  readonly action: AgentMemOSSemanticFragmentAction;
  readonly candidate?: number;
  readonly assessments: readonly AgentMemOSMemoryAssessment[];
}

/** A completed turn may have no durable or current-session knowledge to retain. */
export interface AgentMemOSSemanticSkip {
  readonly action: "skip";
  readonly assessments: readonly AgentMemOSMemoryAssessment[];
}

export type AgentMemOSSemanticDecision = AgentMemOSSemanticFragment | AgentMemOSSemanticSkip;

export const AgentMemOSSemanticFragmentActions = ["new", "update", "supersede"] as const;
export type AgentMemOSSemanticFragmentAction = (typeof AgentMemOSSemanticFragmentActions)[number];

export interface AgentMemOSSemanticCandidate {
  readonly ref: number;
  readonly summary: string;
  readonly type: AgentMemOSSemanticMemoryType;
  readonly delivered?: boolean;
  /** Delivered legacy/foreign knowledge can be assessed without granting write access. */
  readonly assessmentOnly?: boolean;
  /** Actual immutable prompt versions; summary above is the current reconciliation target. */
  readonly deliveredVersions?: readonly { readonly revision: string; readonly summary: string }[];
}

export interface AgentMemOSFragmentHistoryEntry {
  readonly user: string;
  readonly assistant: string;
  readonly stateCard?: AgentStateCard;
}

export interface AgentMemOSFragmentPromptInput {
  /** Host-bound person for this extraction; group participants remain distinct. */
  readonly subject?: { readonly kind: "user" | "agent" | "unknown"; readonly reference?: string };
  readonly user: string;
  readonly assistant: string;
  readonly stateCard?: AgentStateCard;
  readonly history: readonly AgentMemOSFragmentHistoryEntry[];
  readonly candidates: readonly AgentMemOSSemanticCandidate[];
  readonly memoryIntents: readonly string[];
  readonly sources?: readonly { readonly ref: number; readonly kind: string; readonly text: string }[];
}
