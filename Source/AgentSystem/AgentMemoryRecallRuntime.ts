import MiniSearch from "minisearch";
import { z } from "zod";
import { throwIfAborted } from "./AgentCancellation.js";
import { resolveVectorModelsConfig } from "./AgentDefaults.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "./AgentToolProcessEnvelope.js";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
  normalizeToolStringArgument,
} from "./AgentToolArgumentNormalization.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import { AgentVectorModelClient } from "./Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "./Vector/AgentVectorSimilarity.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import {
  AgentMemoryTypes,
  DefaultAgentMemoryDatabasePath,
  resolveAgentMemoryDatabasePath,
  SqliteAgentMemorySourceRepository,
  type AgentMemoryEpisodeRecord,
  type AgentMemoryItemRecord,
  type AgentMemorySourceRecord,
  type AgentMemorySourceRepository,
} from "./Memory/AgentMemorySourceRepository.js";
import {
  memoryItemRecallText,
} from "./Memory/AgentMemoryText.js";
import {
  ensureMemoryItemVectors,
} from "./Memory/AgentMemoryVectorIndex.js";

const MemoryRecallScopeValues = [
  "all",
  ...AgentMemoryTypes,
] as const;

const MemoryRecallPolicy = {
  defaultLimit: 5,
  candidateMultiplier: 4,
  minimumCandidatePool: 12,
  rrfK: 60,
} as const;

const MemoryRecallArgumentsSchema = z
  .object({
    query: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    scope: z.enum(MemoryRecallScopeValues).optional(),
    limit: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    refs: z.preprocess(
      normalizeToolArrayArgument,
      z.array(z.string().trim().min(1)).min(1),
    ).optional(),
  })
  .strict();

export type MemoryRecallScope = typeof MemoryRecallScopeValues[number];
export type MemoryRecallToolArguments = z.infer<typeof MemoryRecallArgumentsSchema>;

interface MemoryRecallDocument {
  id: string;
  type: string;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string;
  triggers: string;
}

interface ConversationRecallDocument {
  id: string;
  rawUserText: string;
  standaloneRequest: string;
  topic: string;
  summary: string;
  contextBasis: string;
}

interface MemoryRecallRankedEntry {
  memoryUri: string;
  score: number;
}

interface MemoryRecallRanking {
  name: "exact_ref" | "keyword" | "semantic" | "rerank";
  entries: MemoryRecallRankedEntry[];
}

interface ConversationRecallRankedEntry {
  episodeUri: string;
  score: number;
}

interface ConversationRecallRanking {
  name: "exact_ref" | "keyword" | "rerank";
  entries: ConversationRecallRankedEntry[];
}

interface MemoryRecallResultEntry {
  memoryUri: string;
  type: string;
  subject: string;
  claim: string;
  howToApply: string;
  tags: { item: string[] };
  triggers: { item: string[] };
  sourceRefs: { item: string[] };
  matchedBy: { item: string[] };
  score: number;
  confidence: number;
  updatedAt: string;
  localDate: string;
}

interface MemoryRecallTurnMessage {
  sourceRef: string;
  text: string;
  summary: string;
}

interface MemoryRecallTurnEntry {
  episodeUri: string;
  requestId: string;
  userMessage: MemoryRecallTurnMessage;
  assistantMessage: MemoryRecallTurnMessage;
  sourceRefs: { item: string[] };
  matchedBy: { item: string[] };
  score: number;
  startedAt: string;
  completedAt: string;
  localDate: string;
}

interface MemoryRecallSourceEntry {
  sourceRef: string;
  sourceKind: string;
  role: string;
  summary: string;
  evidenceUri: string;
  artifactUri: string;
  toolName: string;
  createdAt: string;
  localDate: string;
}

interface MemoryRecallFallbackState {
  used: boolean;
  reason: string;
}

export interface MemoryRecallResult {
  query: string;
  scope: MemoryRecallScope;
  limit: number;
  refs: { item: string[] };
  memories: { item: MemoryRecallResultEntry[] };
  turns: { item: MemoryRecallTurnEntry[] };
  sources: { item: MemoryRecallSourceEntry[] };
  fallback: MemoryRecallFallbackState;
  warnings: { item: string[] };
  guidance: string;
}

export interface MemoryRecallOptions {
  repository: AgentMemorySourceRepository;
  config: AgentSystemConfig;
  signal?: AbortSignal;
}

export const recallMemoryHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = MemoryRecallArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return memoryRecallFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "MemoryRecallTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  const repository = new SqliteAgentMemorySourceRepository(
    resolveAgentMemoryDatabasePath(context.workspaceRoot, DefaultAgentMemoryDatabasePath),
  );
  try {
    throwIfAborted(context.signal);
    return okMemoryRecallResult(await recallAgentMemories(parsed.data, {
      repository,
      config: context.config,
      signal: context.signal,
    }));
  } catch (error) {
    return memoryRecallFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  } finally {
    repository.close();
  }
};

export async function recallAgentMemories(
  args: MemoryRecallToolArguments,
  options: MemoryRecallOptions,
): Promise<MemoryRecallResult> {
  const limit = args.limit ?? MemoryRecallPolicy.defaultLimit;
  const candidateLimit = Math.max(
    limit * MemoryRecallPolicy.candidateMultiplier,
    MemoryRecallPolicy.minimumCandidatePool,
  );
  const refs = unique(args.refs ?? []);
  const scope = args.scope ?? "all";
  const warnings: string[] = [];
  const items = scopedItems(options.repository.listActiveMemoryItems(), scope);
  const itemsByUri = new Map(items.map((item) => [item.uri, item]));
  const exactSources = refs.length > 0
    ? options.repository.findMemorySourcesByRefs(refs)
    : [];

  const initialRankings: MemoryRecallRanking[] = [
    {
      name: "exact_ref",
      entries: exactRefRanking({
        refs,
        sources: exactSources,
        items,
        directItems: options.repository.findMemoryItemsByUris(refs)
          .filter((item) => itemsByUri.has(item.uri)),
      }),
    },
    {
      name: "keyword",
      entries: keywordRanking(args.query, items),
    },
  ];

  const semantic = await semanticRanking(args.query, items, options)
    .catch((error) => {
      warnings.push(`semantic recall unavailable: ${readErrorMessage(error)}`);
      return [];
    });
  initialRankings.push({
    name: "semantic",
    entries: semantic,
  });

  const candidateUris = fuseRankings(initialRankings, candidateLimit)
    .map((entry) => entry.memoryUri);
  const reranked = await rerankMemories(args.query, candidateUris, itemsByUri, options)
    .catch((error) => {
      warnings.push(`memory rerank unavailable: ${readErrorMessage(error)}`);
      return [];
    });

  const ranked = fuseRankings([
    ...initialRankings,
    {
      name: "rerank",
      entries: reranked,
    },
  ], limit);
  const results = ranked.flatMap((entry) => {
    const item = itemsByUri.get(entry.memoryUri);
    return item
      ? [projectMemoryResult(item, entry)]
      : [];
  });
  const turns = results.length === 0
    ? await recallConversationTurns({
      query: args.query,
      refs,
      limit,
      candidateLimit,
      exactSources,
      options,
    }).catch((error) => {
      warnings.push(`conversation recall unavailable: ${readErrorMessage(error)}`);
      return [];
    })
    : [];
  const returnedSourceRefs = unique([
    ...results.flatMap((entry) => entry.sourceRefs.item),
    ...turns.flatMap((entry) => entry.sourceRefs.item),
  ]);
  const returnedSources = returnedSourceRefs.length > 0
    ? options.repository.findMemorySourcesByRefs(returnedSourceRefs).map(projectSourceResult)
    : [];
  const fallback = {
    used: results.length === 0,
    reason: fallbackReason(results, turns),
  };

  return {
    query: args.query,
    scope,
    limit,
    refs: { item: refs },
    memories: { item: results },
    turns: { item: turns },
    sources: { item: returnedSources },
    fallback,
    warnings: { item: warnings },
    guidance: memoryRecallGuidance(results, turns),
  };
}

async function recallConversationTurns(input: {
  query: string;
  refs: readonly string[];
  limit: number;
  candidateLimit: number;
  exactSources: readonly AgentMemorySourceRecord[];
  options: MemoryRecallOptions;
}): Promise<MemoryRecallTurnEntry[]> {
  const episodes = input.options.repository.listCompletedEpisodes();
  const episodesByUri = new Map(episodes.map((episode) => [episode.uri, episode]));
  const initialRankings: ConversationRecallRanking[] = [
    {
      name: "exact_ref",
      entries: conversationExactRefRanking({
        refs: input.refs,
        sources: input.exactSources,
        episodes,
        directEpisodes: input.options.repository.findEpisodesByUris(input.refs)
          .filter((episode) => episodesByUri.has(episode.uri)),
      }),
    },
    {
      name: "keyword",
      entries: conversationKeywordRanking(input.query, episodes),
    },
  ];
  const candidateEpisodeUris = fuseConversationRankings(initialRankings, input.candidateLimit)
    .map((entry) => entry.episodeUri);
  const reranked = await rerankConversationTurns(
    input.query,
    candidateEpisodeUris,
    episodesByUri,
    input.options,
  );
  return fuseConversationRankings([
    ...initialRankings,
    {
      name: "rerank",
      entries: reranked,
    },
  ], input.limit).flatMap((entry) => {
    const episode = episodesByUri.get(entry.episodeUri);
    return episode
      ? [projectConversationTurnResult(
        episode,
        input.options.repository.listSources(episode.uri),
        entry,
      )]
      : [];
  });
}

function conversationExactRefRanking(input: {
  refs: readonly string[];
  sources: readonly AgentMemorySourceRecord[];
  episodes: readonly AgentMemoryEpisodeRecord[];
  directEpisodes: readonly AgentMemoryEpisodeRecord[];
}): ConversationRecallRankedEntry[] {
  const episodeUris = new Set([
    ...input.directEpisodes.map((episode) => episode.uri),
    ...input.sources.map((source) => source.episodeUri),
  ]);
  return input.episodes
    .filter((episode) => episodeUris.has(episode.uri))
    .map((episode) => ({
      episodeUri: episode.uri,
      score: 1,
    }));
}

function conversationKeywordRanking(
  query: string,
  episodes: readonly AgentMemoryEpisodeRecord[],
): ConversationRecallRankedEntry[] {
  if (episodes.length === 0) {
    return [];
  }

  const tokenizer = new AgentToolSearchTokenizer();
  const index = new MiniSearch<ConversationRecallDocument>({
    idField: "id",
    fields: [
      "rawUserText",
      "standaloneRequest",
      "topic",
      "summary",
      "contextBasis",
    ],
    storeFields: ["id"],
    tokenize: (text) => tokenizer.tokenize(text),
    processTerm: (term) => term,
  });
  index.addAll(episodes.map(conversationSearchDocument));
  return index.search(query, {
    prefix: true,
    fuzzy: 0.2,
    combineWith: "OR",
  }).map((entry) => ({
    episodeUri: String(entry.id),
    score: entry.score,
  }));
}

async function rerankConversationTurns(
  query: string,
  episodeUris: readonly string[],
  episodesByUri: ReadonlyMap<string, AgentMemoryEpisodeRecord>,
  options: MemoryRecallOptions,
): Promise<ConversationRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Rerank.Enabled || episodeUris.length === 0) {
    return [];
  }

  const rerank = await new AgentVectorModelClient(vectorConfig).rerank({
    query,
    documents: episodeUris.flatMap((episodeUri) => {
      const episode = episodesByUri.get(episodeUri);
      return episode ? [{
        id: episodeUri,
        text: conversationTurnRecallText(episode),
      }] : [];
    }),
    topK: episodeUris.length,
    signal: options.signal,
  });
  return rerank.results.map((entry) => ({
    episodeUri: entry.id,
    score: entry.score,
  }));
}

function scopedItems(
  items: readonly AgentMemoryItemRecord[],
  scope: MemoryRecallScope,
): AgentMemoryItemRecord[] {
  return scope === "all"
    ? [...items]
    : items.filter((item) => item.type === scope);
}

function exactRefRanking(input: {
  refs: readonly string[];
  sources: readonly AgentMemorySourceRecord[];
  items: readonly AgentMemoryItemRecord[];
  directItems: readonly AgentMemoryItemRecord[];
}): MemoryRecallRankedEntry[] {
  const sourceRefs = new Set([
    ...input.refs,
    ...input.sources.map((source) => source.uri),
  ]);
  const directUris = new Set(input.directItems.map((item) => item.uri));
  return input.items
    .filter((item) =>
      directUris.has(item.uri)
      || item.sourceRefs.some((sourceRef) => sourceRefs.has(sourceRef)))
    .map((item) => ({
      memoryUri: item.uri,
      score: 1,
    }));
}

function keywordRanking(
  query: string,
  items: readonly AgentMemoryItemRecord[],
): MemoryRecallRankedEntry[] {
  if (items.length === 0) {
    return [];
  }

  const tokenizer = new AgentToolSearchTokenizer();
  const index = new MiniSearch<MemoryRecallDocument>({
    idField: "id",
    fields: [
      "type",
      "subject",
      "claim",
      "howToApply",
      "tags",
      "triggers",
    ],
    storeFields: ["id"],
    tokenize: (text) => tokenizer.tokenize(text),
    processTerm: (term) => term,
  });
  index.addAll(items.map(memorySearchDocument));
  return index.search(query, {
    prefix: true,
    fuzzy: 0.2,
    combineWith: "OR",
  }).map((entry) => ({
    memoryUri: String(entry.id),
    score: entry.score,
  }));
}

async function semanticRanking(
  query: string,
  items: readonly AgentMemoryItemRecord[],
  options: MemoryRecallOptions,
): Promise<MemoryRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Embedding.Enabled || items.length === 0) {
    return [];
  }

  const vectorClient = new AgentVectorModelClient(vectorConfig);
  await ensureMemoryItemVectors(vectorClient, options.repository, items, vectorConfig.Embedding.Model, options.signal);
  const vectors = new Map(
    options.repository.listMemoryItemVectors(vectorConfig.Embedding.Model)
      .map((record) => [record.memoryUri, record]),
  );
  const queryEmbedding = (await vectorClient.embed({
    input: [query],
    signal: options.signal,
  })).vectors[0];
  if (!queryEmbedding) {
    return [];
  }

  return items.flatMap((item) => {
    const vector = vectors.get(item.uri);
    return vector
      ? [{
        memoryUri: item.uri,
        score: cosineSimilarity(queryEmbedding, vector.embedding),
      }]
      : [];
  }).sort((left, right) => right.score - left.score || left.memoryUri.localeCompare(right.memoryUri));
}

async function rerankMemories(
  query: string,
  memoryUris: readonly string[],
  itemsByUri: ReadonlyMap<string, AgentMemoryItemRecord>,
  options: MemoryRecallOptions,
): Promise<MemoryRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Rerank.Enabled || memoryUris.length === 0) {
    return [];
  }

  const rerank = await new AgentVectorModelClient(vectorConfig).rerank({
    query,
    documents: memoryUris.flatMap((memoryUri) => {
      const item = itemsByUri.get(memoryUri);
      return item ? [{
        id: memoryUri,
        text: memoryItemRecallText(item),
      }] : [];
    }),
    topK: memoryUris.length,
    signal: options.signal,
  });
  return rerank.results.map((entry) => ({
    memoryUri: entry.id,
    score: entry.score,
  }));
}

function fuseRankings(
  rankings: readonly MemoryRecallRanking[],
  limit: number,
): Array<MemoryRecallRankedEntry & { matchedBy: string[] }> {
  const scores = new Map<string, {
    memoryUri: string;
    score: number;
    matchedBy: string[];
  }>();

  for (const ranking of rankings) {
    const seenInRanking = new Set<string>();
    ranking.entries.forEach((entry, index) => {
      if (seenInRanking.has(entry.memoryUri)) {
        return;
      }
      seenInRanking.add(entry.memoryUri);
      const current = scores.get(entry.memoryUri) ?? {
        memoryUri: entry.memoryUri,
        score: 0,
        matchedBy: [],
      };
      scores.set(entry.memoryUri, {
        memoryUri: entry.memoryUri,
        score: current.score + 1 / (MemoryRecallPolicy.rrfK + index + 1),
        matchedBy: unique([
          ...current.matchedBy,
          ranking.name,
        ]),
      });
    });
  }

  return [...scores.values()]
    .sort((left, right) =>
      exactRank(right) - exactRank(left)
      || right.score - left.score
      || left.memoryUri.localeCompare(right.memoryUri))
    .slice(0, limit);
}

function fuseConversationRankings(
  rankings: readonly ConversationRecallRanking[],
  limit: number,
): Array<ConversationRecallRankedEntry & { matchedBy: string[] }> {
  const scores = new Map<string, {
    episodeUri: string;
    score: number;
    matchedBy: string[];
  }>();

  for (const ranking of rankings) {
    const seenInRanking = new Set<string>();
    ranking.entries.forEach((entry, index) => {
      if (seenInRanking.has(entry.episodeUri)) {
        return;
      }
      seenInRanking.add(entry.episodeUri);
      const current = scores.get(entry.episodeUri) ?? {
        episodeUri: entry.episodeUri,
        score: 0,
        matchedBy: [],
      };
      scores.set(entry.episodeUri, {
        episodeUri: entry.episodeUri,
        score: current.score + 1 / (MemoryRecallPolicy.rrfK + index + 1),
        matchedBy: unique([
          ...current.matchedBy,
          ranking.name,
        ]),
      });
    });
  }

  return [...scores.values()]
    .sort((left, right) =>
      exactRank(right) - exactRank(left)
      || right.score - left.score
      || left.episodeUri.localeCompare(right.episodeUri))
    .slice(0, limit);
}

function exactRank(entry: { matchedBy: readonly string[] }): number {
  return entry.matchedBy.includes("exact_ref") ? 1 : 0;
}

function memorySearchDocument(item: AgentMemoryItemRecord): MemoryRecallDocument {
  return {
    id: item.uri,
    type: item.type,
    subject: item.subject,
    claim: item.claim,
    howToApply: item.howToApply,
    tags: item.tags.join(" "),
    triggers: item.triggers.join(" "),
  };
}

function conversationSearchDocument(episode: AgentMemoryEpisodeRecord): ConversationRecallDocument {
  return {
    id: episode.uri,
    rawUserText: episode.rawUserText,
    standaloneRequest: episode.standaloneRequest,
    topic: episode.topic,
    summary: episode.summary,
    contextBasis: episode.contextBasis,
  };
}

function conversationTurnRecallText(episode: AgentMemoryEpisodeRecord): string {
  return [
    episode.rawUserText,
    episode.standaloneRequest,
    episode.topic,
    episode.summary,
    episode.contextBasis,
  ].join("\n");
}

function projectMemoryResult(
  item: AgentMemoryItemRecord,
  ranked: MemoryRecallRankedEntry & { matchedBy: string[] },
): MemoryRecallResultEntry {
  return {
    memoryUri: item.uri,
    type: item.type,
    subject: item.subject,
    claim: item.claim,
    howToApply: item.howToApply,
    tags: { item: item.tags },
    triggers: { item: item.triggers },
    sourceRefs: { item: item.sourceRefs },
    matchedBy: { item: ranked.matchedBy },
    score: Number(ranked.score.toFixed(6)),
    confidence: Number(item.confidence.toFixed(6)),
    updatedAt: item.updatedAt,
    localDate: item.localDate,
  };
}

function projectConversationTurnResult(
  episode: AgentMemoryEpisodeRecord,
  sources: readonly AgentMemorySourceRecord[],
  ranked: ConversationRecallRankedEntry & { matchedBy: string[] },
): MemoryRecallTurnEntry {
  const userSource = sources.find((source) => source.sourceKind === "user_message");
  const assistantSource = sources.find((source) => source.sourceKind === "assistant_final");
  return {
    episodeUri: episode.uri,
    requestId: episode.requestId,
    userMessage: {
      sourceRef: userSource?.uri ?? "",
      text: userSource?.textContent ?? episode.rawUserText,
      summary: userSource?.summary ?? episode.standaloneRequest,
    },
    assistantMessage: {
      sourceRef: assistantSource?.uri ?? "",
      text: assistantSource?.textContent ?? episode.summary,
      summary: assistantSource?.summary ?? episode.summary,
    },
    sourceRefs: {
      item: unique(sources.map((source) => source.uri)),
    },
    matchedBy: {
      item: ranked.matchedBy,
    },
    score: Number(ranked.score.toFixed(6)),
    startedAt: episode.startedAt,
    completedAt: episode.completedAt,
    localDate: episode.localDate,
  };
}

function projectSourceResult(source: AgentMemorySourceRecord): MemoryRecallSourceEntry {
  return {
    sourceRef: source.uri,
    sourceKind: source.sourceKind,
    role: source.role,
    summary: source.summary ?? "",
    evidenceUri: source.evidenceUri,
    artifactUri: source.artifactUri,
    toolName: source.toolName,
    createdAt: source.createdAt,
    localDate: source.localDate,
  };
}

function memoryRecallGuidance(
  memories: readonly MemoryRecallResultEntry[],
  turns: readonly MemoryRecallTurnEntry[],
): string {
  if (memories.length > 0) {
    return "Use recalled memories as durable user/project context. Cite sourceRefs when explaining why a memory applies.";
  }
  if (turns.length > 0) {
    return "No active long-term memory matched. Use returned conversation turns as historical context, not as durable preference or knowledge unless the quoted user/assistant text directly supports it.";
  }
  return "No active long-term memory or ordinary conversation memory matched this query.";
}

function fallbackReason(
  memories: readonly MemoryRecallResultEntry[],
  turns: readonly MemoryRecallTurnEntry[],
): string {
  if (memories.length > 0) {
    return "";
  }
  return turns.length > 0
    ? "No active long-term memory matched; searched ordinary conversation memory instead."
    : "No active long-term memory matched; ordinary conversation memory search also returned no matches.";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function okMemoryRecallResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function memoryRecallFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
