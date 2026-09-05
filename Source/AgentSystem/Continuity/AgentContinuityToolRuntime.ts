import { z } from "zod";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import {
  SqliteAgentMemorySourceRepository,
  type AgentMemorySourceRecord,
} from "../Memory/AgentMemorySourceRepository.js";
import type { AgentHostToolHandler } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import { AgentContinuityEpisodeRecall } from "./AgentContinuityEpisodeRecall.js";
import { AgentContinuityRecordRanker, type AgentContinuityRankedRecord } from "./AgentContinuityRecordRanker.js";
import { listAgentContinuityPromptScopes } from "./AgentContinuityScopes.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import { resolveAgentWorldConfig, resolveContinuityLearningConfig } from "../AgentDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { buildAgentContinuityEpisodeWindow } from "./AgentContinuityEpisodeWindow.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import { withAgentContinuitySession, type AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import { AgentTemporalMemorySqliteStore } from "../TemporalMemory/AgentTemporalMemorySqliteStore.js";
import { AgentTemporalMemoryRecall } from "../TemporalMemory/AgentTemporalMemoryRecall.js";
import { projectAgentTemporalMemoryScope } from "../TemporalMemory/AgentTemporalMemoryIdentity.js";
import { agentTemporalMemoryRange } from "../TemporalMemory/AgentTemporalMemoryPeriod.js";
import type { AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";

const NonEmptyText = z.string().trim().min(1);
const Lifetime = z.union([z.enum(["session", "permanent"]), z.string().datetime({ offset: true })]);

export const ContinuityWriteArgumentsSchema = z
  .object({
    summary: NonEmptyText.describe("The explicit fact the user asked Senera to remember."),
    until: Lifetime.optional().describe(
      "How long the fact remains valid. Defaults to permanent; timestamps must be RFC 3339 with an offset.",
    ),
  })
  .strict();

export const ContinuityRecallArgumentsSchema = z
  .object({
    query: NonEmptyText.optional().describe("Natural-language description of the learned fact to recall."),
    refs: z
      .array(NonEmptyText)
      .min(1)
      .optional()
      .describe(
        "Exact senera://continuity-learning, senera://memory-digest, senera://memory-episode, or senera://memory-source references to read.",
      ),
    before: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Completed turns to include before each matched physical episode."),
    after: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Completed turns to include after each matched physical episode."),
    from: NonEmptyText.optional().describe(
      "Start of a historical range as YYYY-MM-DD or RFC 3339. Date-only boundaries use the configured world time zone.",
    ),
    to: NonEmptyText.optional().describe(
      "Inclusive end date as YYYY-MM-DD, or exclusive RFC 3339 end instant, for a historical range.",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.query && (!value.refs || value.refs.length === 0)) {
      if (!value.from || !value.to)
        context.addIssue({ code: "custom", message: "Memory recall requires query, refs, or a complete time range." });
    }
    if ((value.from === undefined) !== (value.to === undefined)) {
      context.addIssue({ code: "custom", message: "Memory recall time ranges require both from and to." });
    }
  });

export type ContinuityWriteToolArguments = z.infer<typeof ContinuityWriteArgumentsSchema>;
export type ContinuityRecallToolArguments = z.infer<typeof ContinuityRecallArgumentsSchema>;

interface ContinuityRecallRecordResult {
  readonly recordUri: string;
  readonly kind: string;
  readonly summary: string;
  readonly sourceRefs: { readonly item: string[] };
  readonly matchedBy: { readonly item: string[] };
  readonly score: number;
  readonly confidence: number;
  readonly authority: string;
  readonly observedAt: string;
}

interface ContinuityRecallSourceResult {
  readonly episodeRef: string;
  readonly sourceRef: string;
  readonly sourceKind: string;
  readonly role: string;
  readonly summary: string;
  readonly text: string;
  readonly toolName: string;
  readonly createdAt: string;
  readonly anchor: boolean;
}

interface ContinuityRecallEpisodeResult {
  readonly episodeRef: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly topic: string;
  readonly assistantPreview: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly anchorSourceRefs: { readonly item: string[] };
  readonly sourceRefs: { readonly item: string[] };
}

interface ContinuityRecallDigestResult {
  readonly digestRef: string;
  readonly granularity: string;
  readonly status: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timeZone: string;
  readonly summary: string;
  readonly topics: { readonly item: string[] };
  readonly openLoops: { readonly item: string[] };
  readonly sourceRefs: { readonly item: string[] };
}

interface ContinuityRecallResult {
  readonly query?: string;
  readonly refs: { readonly item: string[] };
  readonly range?: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly digests: { readonly item: ContinuityRecallDigestResult[] };
  readonly records: { readonly item: ContinuityRecallRecordResult[] };
  readonly episodes: { readonly item: ContinuityRecallEpisodeResult[] };
  readonly sources: { readonly item: ContinuityRecallSourceResult[] };
  readonly guidance: string;
}

/**
 * Produces a physical tool-evidence intent. The completed episode learner is
 * the sole component allowed to turn it into a durable learning.record.
 */
export const writeContinuityHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ContinuityWriteArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return toolValidationFailure("MemoryWriteTool 参数无效。", parsed.error.issues, context.tool.name);
  }
  try {
    throwIfAborted(context.signal);
    return toolProcessSuccessResult({
      status: "accepted_for_learning",
      records: {
        item: [
          {
            kind: "fact",
            summary: parsed.data.summary,
            until: parsed.data.until ?? "permanent",
          },
        ],
      },
      guidance:
        "This explicit memory intent is now physical tool evidence. The completed-turn learner will persist it through the single learning.record pipeline.",
    });
  } catch (error) {
    return toolExecutionFailure(error, context.tool.name);
  }
};

export const recallContinuityHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ContinuityRecallArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return toolValidationFailure("MemoryRecallTool 参数无效。", parsed.error.issues, context.tool.name);
  }

  const database = openContinuityDatabase(context.workspaceRoot);
  const store = new AgentContinuitySqliteStore(database);
  const sources = new SqliteAgentMemorySourceRepository(database);
  const temporalMemoryStore = new AgentTemporalMemorySqliteStore(database);
  try {
    throwIfAborted(context.signal);
    return toolProcessSuccessResult(
      recallContinuity(parsed.data, {
        store,
        sourceRepository: sources,
        temporalMemoryStore,
        identityTemplateValues: context.identityTemplateValues,
        identity: requireToolContinuityIdentity(context.continuityIdentity, context.sessionId),
        sessionId: context.sessionId,
        ranking: resolveContinuityLearningConfig(context.config).Recall.Ranking,
        timeZone: resolveAgentWorldConfig(context.config).TimeZone,
      }),
    );
  } catch (error) {
    return toolExecutionFailure(error, context.tool.name);
  } finally {
    database.close();
  }
};

export function recallContinuity(
  args: ContinuityRecallToolArguments,
  options: {
    readonly store: AgentContinuitySqliteStore;
    readonly sourceRepository: AgentMemorySourceRepository;
    readonly temporalMemoryStore: AgentTemporalMemorySqliteStore;
    readonly identityTemplateValues?: () => AgentIdentityTemplateValues;
    readonly identity: AgentContinuityIdentityContext;
    readonly sessionId?: string;
    readonly ranking: ResolvedAgentContinuityRecallRankingConfig;
    readonly timeZone: string;
  },
): ContinuityRecallResult {
  const refs = uniqueStrings(args.refs ?? []);
  const range = args.from && args.to ? agentTemporalMemoryRange(args.from, args.to, options.timeZone) : undefined;
  const temporal = new AgentTemporalMemoryRecall(options.temporalMemoryStore, options.identityTemplateValues).read({
    scopeKey: projectAgentTemporalMemoryScope(options.identity).key,
    range,
    refs,
  });
  const allObservations = options.store.listLearningObservations(
    listAgentContinuityPromptScopes(options.identity, options.sessionId),
  );
  const observations = range
    ? allObservations.filter((observation) => withinRange(observation.occurredAt, range.startMs, range.endMs))
    : allObservations;
  const physicalObservations = new AgentContinuityEpisodeRecall(options.sourceRepository).read({
    identity: options.identity,
    sessionId: options.sessionId,
    mode: "explicit",
    ...(range ? { range } : {}),
  }).observations;
  const uncoveredPhysicalObservations = range
    ? physicalObservations.filter(
        (observation) =>
          typeof observation.payload.episodeUri !== "string" ||
          !temporal.coveredEpisodeUris.has(observation.payload.episodeUri),
      )
    : physicalObservations;
  const exact = [...observations, ...physicalObservations].filter((observation) =>
    matchesObservationReferences(observation, refs),
  );
  const ranker = new AgentContinuityRecordRanker(options.ranking);
  const ranked = ranker.rank({
    query: args.query ?? "",
    observations,
    sessionId: options.sessionId,
  }).records;
  const rankedPhysical = ranker.rankEvents({
    query: args.query ?? "",
    observations: uncoveredPhysicalObservations,
    sessionId: options.sessionId,
  }).records;
  const selected = mergeRecordMatches(exact, [...ranked, ...rankedPhysical]);
  const sourceRefs = uniqueStrings([...refs, ...selected.flatMap((entry) => entry.observation.sourceRefs)]);
  const referencedEpisodeSources = options.sourceRepository.listSourcesForEpisodes(
    options.sourceRepository.findEpisodesByUris(refs).map((episode) => episode.uri),
  );
  const anchorSources = uniqueSources([
    ...options.sourceRepository.findMemorySourcesByRefs(sourceRefs),
    ...referencedEpisodeSources,
  ]);
  const episodeWindow = buildAgentContinuityEpisodeWindow({
    sourceRepository: options.sourceRepository,
    anchorSources,
    before: args.before ?? 0,
    after: args.after ?? 0,
  });
  const anchorSourceRefs = new Set(anchorSources.map((source) => source.uri));
  return {
    ...(args.query ? { query: args.query } : {}),
    refs: { item: refs },
    ...(range ? { range: { from: range.start, to: range.end, timeZone: range.timeZone } } : {}),
    digests: {
      item: temporal.digests.map((digest) => ({
        ...digest,
        topics: { item: [...digest.topics] },
        openLoops: { item: [...digest.openLoops] },
        sourceRefs: { item: [...digest.sourceRefs] },
      })),
    },
    records: { item: selected.map(projectRecallRecord) },
    episodes: {
      item: episodeWindow.map((entry) => ({
        episodeRef: entry.episode.uri,
        sessionId: entry.episode.sessionId,
        requestId: entry.episode.requestId,
        topic: entry.episode.topic,
        assistantPreview: entry.episode.assistantPreview,
        startedAt: entry.episode.startedAt,
        completedAt: entry.episode.completedAt,
        anchorSourceRefs: { item: [...entry.anchorSourceRefs] },
        sourceRefs: { item: entry.sources.map((source) => source.uri) },
      })),
    },
    sources: {
      item: episodeWindow.flatMap((entry) =>
        entry.sources.map((source) => projectRecallSource(source, anchorSourceRefs.has(source.uri))),
      ),
    },
    guidance:
      temporal.digests.length > 0
        ? "Temporal digests are ordered from the coarsest complete periods to boundary segments. Follow sourceRefs only when finer evidence is needed."
        : selected.length > 0
          ? "These records come from the continuity ledger or physical episode evidence. Use source entries as the evidence before relying on them."
          : "No relevant continuity record, temporal digest, or exact physical source was found.",
  };
}

function withinRange(value: string, startMs: number, endMs: number): boolean {
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant >= startMs && instant < endMs;
}

function requireToolContinuityIdentity(
  identity: AgentContinuityIdentityContext | undefined,
  sessionId: string | undefined,
): AgentContinuityIdentityContext {
  if (!identity) throw new Error("Continuity identity is unavailable in the tool execution context.");
  return withAgentContinuitySession(identity, sessionId);
}

function mergeRecordMatches(
  exact: readonly AgentContinuityObservation[],
  ranked: readonly AgentContinuityRankedRecord[],
): AgentContinuityRankedRecord[] {
  const matches = new Map<string, AgentContinuityRankedRecord>();
  for (const observation of exact) {
    matches.set(observation.uri, {
      observation,
      score: 1,
      textSimilarityScore: 1,
      lexicalScore: 1,
      semanticScore: 0,
      matchedBy: ["exact_ref"],
      projection: "direct",
    });
  }
  for (const entry of ranked) {
    if (!matches.has(entry.observation.uri)) matches.set(entry.observation.uri, entry);
  }
  return [...matches.values()];
}

function matchesObservationReferences(observation: AgentContinuityObservation, refs: readonly string[]): boolean {
  if (refs.includes(observation.uri) || observation.sourceRefs.some((ref) => refs.includes(ref))) return true;
  const episodeUri = observation.payload.episodeUri;
  return typeof episodeUri === "string" && refs.includes(episodeUri);
}

function projectRecallRecord(entry: AgentContinuityRankedRecord): ContinuityRecallRecordResult {
  return {
    recordUri: entry.observation.uri,
    kind: typeof entry.observation.payload.kind === "string" ? entry.observation.payload.kind : "fact",
    summary: entry.observation.summary,
    sourceRefs: { item: [...entry.observation.sourceRefs] },
    matchedBy: { item: [...entry.matchedBy] },
    score: entry.score,
    confidence: entry.observation.confidence,
    authority: entry.observation.authority,
    observedAt: entry.observation.observedAt,
  };
}

function projectRecallSource(source: AgentMemorySourceRecord, anchor: boolean): ContinuityRecallSourceResult {
  return {
    episodeRef: source.episodeUri,
    sourceRef: source.uri,
    sourceKind: source.sourceKind,
    role: source.role,
    summary: source.summary ?? "",
    text: source.textContent ?? "",
    toolName: source.toolName,
    createdAt: source.createdAt,
    anchor,
  };
}

function openContinuityDatabase(workspaceRoot: string): AgentSqliteDatabaseKernel {
  return new AgentSqliteDatabaseKernel({
    databasePath: resolveAgentWorkspaceLayout(workspaceRoot).databases.memory,
    contract: AgentMemoryDatabaseContract,
  });
}

function toolValidationFailure(
  message: string,
  issues: readonly z.ZodIssue[],
  toolName: string,
): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.InvalidToolArguments,
    message,
    details: { phase: AgentToolProcessErrorPhases.RuntimeExecution, issues, toolName },
    diagnostics: issues.map((issue) => ({
      message: issue.message,
      pointer: `/${issue.path.join("/")}`,
      path: issue.path.map(String),
    })),
  });
}

function toolExecutionFailure(error: unknown, toolName: string): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.ToolExecutionError,
    message: errorMessage(error),
    details: { phase: AgentToolProcessErrorPhases.RuntimeExecution, toolName },
  });
}

function uniqueSources(sources: readonly AgentMemorySourceRecord[]): AgentMemorySourceRecord[] {
  return [...new Map(sources.map((source) => [source.uri, source])).values()];
}
