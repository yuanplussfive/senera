import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityMemoryPromptContext,
  type AgentContinuityEventCandidate,
} from "./AgentContinuityMemoryTypes.js";
import { AgentContinuitySqliteStore, type AgentContinuityMemorySnapshotEntry } from "./AgentContinuitySqliteStore.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { agentInteractionDisplayValues } from "../Interaction/AgentInteractionIdentity.js";
import { AgentCancellationError, throwAbortReason } from "../Core/AgentCancellation.js";
import type { AgentContinuityLearningRecallConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import {
  applyAgentContinuityPromptBudget,
  type AgentContinuityHistoricalTokenBudget,
} from "./AgentContinuityPromptBudget.js";
import type { AgentContinuityMemOSRuntime, AgentContinuityMemOSSearchResult } from "./AgentContinuityMemOSRuntime.js";
import {
  AgentMemOSSummarySchema,
  agentMemOSRevision,
  isAgentMemOSAutomaticPromptMemory,
  projectAgentMemOSOccurredAt,
} from "./AgentMemOSSemanticTypes.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import { projectAgentMemOSSemanticIdentityText } from "./AgentMemOSSemanticIdentity.js";
import {
  agentMemorySubject,
  agentMemorySubjectOwns,
  type AgentMemoryLearningLedger,
} from "./AgentMemoryLearningLedger.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { readAgentMemOSSemanticMetadata } from "./AgentMemOSSemanticTypes.js";
import {
  renderAgentContinuityPromptWire,
  renderAgentDynamicMemoryWire,
} from "../Prompt/AgentPromptContextWireRenderer.js";
import { agentMemoryQualityWeight, agentMemoryRelevance } from "./AgentMemoryRecallRanking.js";
import type { AgentMemoryRelevanceAssessment } from "./AgentMemoryRelevanceModel.js";

import { resolveAgentContinuityRecallBudgetRatios } from "./AgentContinuityRecallDefaults.js";

interface RecallInput {
  readonly userInput: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly topicRelation?: "continue" | "new_topic";
  readonly resumeRequestId?: string;
  readonly interaction?: AgentInteractionContext;
  readonly signal?: AbortSignal;
  readonly historicalTokenBudget?: AgentContinuityHistoricalTokenBudget;
}

export interface AgentContinuityMemoryServiceOptions {
  readonly store: AgentContinuitySqliteStore;
  readonly recallConfig: () => AgentContinuityLearningRecallConfig;
  readonly memos: Pick<AgentContinuityMemOSRuntime, "search" | "searchRecent"> &
    Partial<Pick<AgentContinuityMemOSRuntime, "taskMemory">>;
  readonly learningLedger?: AgentMemoryLearningLedger;
  readonly assessRelevance: AgentMemoryRelevanceAssessment;
  /** Profile display values are projected at delivery time, not stored as memory. */
  readonly identityDisplayValues?: (sessionId?: string) => AgentIdentityDisplayValues;
  readonly logger?: AgentLogger;
  readonly diaryIndex?: (
    interaction?: import("../Interaction/AgentInteractionContext.js").AgentInteractionContext,
  ) => string;
}

/**
 * Freezes preferences and diary discovery per session boundary. Each turn also
 * retrieves task state and related knowledge without rewriting that snapshot.
 */
export class AgentContinuityMemoryService {
  private readonly snapshotEpochs = new Map<string, number>();
  constructor(private readonly options: AgentContinuityMemoryServiceOptions) {}

  async promptContext(
    input: Omit<RecallInput, "userInput"> & { readonly userInput?: string } = {},
  ): Promise<AgentContinuityMemoryPromptContext> {
    return this.resolveContext({ ...input, userInput: input.userInput ?? "" }, false);
  }

  async liveContext(
    input: Omit<RecallInput, "userInput"> & { readonly userInput?: string } = {},
  ): Promise<AgentContinuityMemoryPromptContext> {
    if (input.sessionId && input.requestId)
      this.options.learningLedger?.task({
        ...input,
        sessionId: input.sessionId,
        requestId: input.requestId,
        subject: agentMemorySubject(input.interaction),
      });
    return this.resolveContext({ ...input, userInput: input.userInput ?? "" }, true);
  }

  invalidateSessionContext(sessionId: string, boundaryKey?: string): number {
    const existed = this.options.store.readMemorySnapshot(sessionId) !== undefined;
    const changed = this.options.store.clearMemorySnapshot(sessionId, boundaryKey);
    if (changed) this.advanceSnapshotEpoch(sessionId);
    return existed ? changed : 0;
  }

  acknowledgeMemoryDelivery(sessionId: string, requestId: string): void {
    this.options.learningLedger?.markDelivered(sessionId, requestId);
  }

  deleteSession(sessionId: string): void {
    this.advanceSnapshotEpoch(sessionId);
    this.options.store.deleteSession(sessionId);
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    // A deleted source may have been projected into another conversation.
    for (const sessionId of this.snapshotEpochs.keys()) this.advanceSnapshotEpoch(sessionId);
    this.options.store.clearAllMemorySnapshots();
    if (impact.scope === "session") this.deleteSession(impact.sessionId);
  }

  private async resolveContext(
    input: RecallInput,
    freezeForSession: boolean,
  ): Promise<AgentContinuityMemoryPromptContext> {
    throwAbortReason(input.signal);
    if (!input.historicalTokenBudget || input.historicalTokenBudget.maxTokens <= 0) return this.empty(input.userInput);
    try {
      for (;;) {
        throwAbortReason(input.signal);
        const context = await this.resolveSnapshotContext(input, freezeForSession);
        if (context) return context;
      }
    } catch (error) {
      if (error instanceof AgentCancellationError) throw error;
      throwAbortReason(input.signal);
      this.options.logger?.warn("memory.memos.prompt_context_failed", {
        sessionId: input.sessionId,
        requestId: input.requestId,
        message: errorMessage(error),
      });
      return this.empty(input.userInput);
    }
  }

  private async resolveSnapshotContext(
    input: RecallInput,
    freezeForSession: boolean,
  ): Promise<AgentContinuityMemoryPromptContext | undefined> {
    const startedAt = performance.now();
    let entries: readonly AgentContinuityMemorySnapshotEntry[];
    let candidateCounts: { available: number; matched: number } | undefined;
    const subject = agentMemorySubject(input.interaction);
    const ledger = this.options.learningLedger;
    const task =
      input.sessionId && input.requestId
        ? ledger?.task(
            {
              sessionId: input.sessionId,
              requestId: input.requestId,
              topicRelation: input.topicRelation,
              resumeRequestId: input.resumeRequestId,
              subject,
            },
            freezeForSession,
          )
        : undefined;
    if (freezeForSession && input.sessionId) this.options.store.prepareSnapshotSubject(input.sessionId, subject.id);
    const generation = input.sessionId ? this.options.store.snapshotGeneration(input.sessionId) : 0;
    if (input.sessionId && !this.snapshotEpochs.has(input.sessionId)) this.snapshotEpochs.set(input.sessionId, 0);
    const epoch = input.sessionId ? this.snapshotEpoch(input.sessionId) : 0;
    const isCurrent = () =>
      !input.sessionId ||
      (epoch === this.snapshotEpoch(input.sessionId) &&
        generation === this.options.store.snapshotGeneration(input.sessionId));
    const identity = agentInteractionDisplayValues(
      this.options.identityDisplayValues?.(input.sessionId),
      input.interaction,
    );
    const budget = {
      ...input.historicalTokenBudget!,
      maxTokens: Math.min(this.options.recallConfig().PromptBudget.MaxTokens, input.historicalTokenBudget!.maxTokens),
    };
    const policy = this.options.recallConfig();
    const ratios = resolveAgentContinuityRecallBudgetRatios(policy);
    const longTermBudget = { ...budget, maxTokens: Math.floor(budget.maxTokens * ratios.FrozenBudgetRatio) };
    const existingSnapshot = input.sessionId
      ? this.options.store.readMemorySnapshot(input.sessionId, subject.id)
      : undefined;
    const [queryRead, catalogRead] = await Promise.all([
      this.readRecall("query", input, () =>
        input.userInput.trim()
          ? this.options.memos.search(input.userInput, ledger ? subject : undefined)
          : Promise.resolve([]),
      ),
      this.readRecall("preferences", input, () =>
        existingSnapshot ? Promise.resolve([]) : this.options.memos.searchRecent(ledger ? subject : undefined),
      ),
    ]);
    const queryResults = queryRead.results;
    const catalog = catalogRead.results;
    const background: NonNullable<AgentContinuityMemoryPromptContext["retrieval"]>["background"] = {
      source: existingSnapshot ? "frozen" : input.userInput.trim() ? "query" : "global_preferences",
      queryCandidates: 0,
      globalPreferenceCandidates: 0,
      keywordMatches: 0,
      semanticMatches: 0,
      status:
        existingSnapshot || (queryRead.status === "completed" && catalogRead.status === "completed")
          ? "completed"
          : "unavailable",
      ...(!existingSnapshot ? { searchLatencyMs: Math.max(queryRead.latencyMs, catalogRead.latencyMs) } : {}),
    };
    let frozenDiaryIndex = existingSnapshot?.diaryIndex ?? "";
    const projectDiaryIndex = () => {
      const tokens = renderAgentContinuityPromptWire(
        {
          ...EmptyAgentContinuityMemoryPromptContext,
          enabled: true,
          diaryIndex: frozenDiaryIndex,
          snapshotGeneration: generation,
        },
        budget,
      ).tokenCount;
      if (tokens > budget.maxTokens) return "";
      longTermBudget.maxTokens = Math.max(longTermBudget.maxTokens, tokens);
      return frozenDiaryIndex;
    };
    let diaryIndex = projectDiaryIndex();
    const diagnostics = {
      unassigned: 0,
      otherSubject: 0,
      irrelevant: 0,
      snapshotReused: existingSnapshot !== undefined,
      relevanceStatus: "not_needed" as "not_needed" | "completed" | "unavailable",
    };
    if (existingSnapshot !== undefined) {
      entries = existingSnapshot.entries;
    } else {
      const [relevant, all] = [queryResults, catalog];
      // Read file titles after the memory read barrier, so source erasure cannot
      // race an old index into a newly selected background.
      frozenDiaryIndex = this.options.diaryIndex?.(input.interaction) ?? "";
      diaryIndex = projectDiaryIndex();
      const eligible = (result: AgentContinuityMemOSSearchResult) =>
        !ledger ||
        agentMemorySubjectOwns(subject, readAgentMemOSSemanticMetadata(result.memory.node)?.senera_subject_id);
      for (const result of all) {
        const owner = readAgentMemOSSemanticMetadata(result.memory.node)?.senera_subject_id;
        if (!owner) diagnostics.unassigned += 1;
        else if (!agentMemorySubjectOwns(subject, owner)) diagnostics.otherSubject += 1;
      }
      // Every queried type, including preferences, retains its real search evidence.
      const candidates = relevant
        .filter((result) => eligible(result) && result.memory.node.type === "preference")
        .flatMap((result) => projectMemOSEvent(result, identity));
      background.queryCandidates = candidates.length;
      background.keywordMatches = candidates.filter((entry) => (entry.scores?.keyword ?? 0) > 0).length;
      background.semanticMatches = candidates.filter((entry) => (entry.scores?.semantic ?? 0) > 0).length;
      let assessed: readonly AgentContinuityEventCandidate[] = [];
      if (candidates.length) {
        const assessmentStartedAt = performance.now();
        try {
          assessed = await this.options.assessRelevance({ query: input.userInput, candidates, signal: input.signal });
          diagnostics.relevanceStatus = "completed";
        } catch (error) {
          throwAbortReason(input.signal);
          if (error instanceof AgentCancellationError) throw error;
          diagnostics.relevanceStatus = "unavailable";
          this.options.logger?.warn("memory.memos.relevance_failed", {
            sessionId: input.sessionId,
            requestId: input.requestId,
            message: errorMessage(error),
          });
        } finally {
          background.assessmentLatencyMs = performance.now() - assessmentStartedAt;
        }
      }
      const queryById = new Map(candidates.map((entry) => [entry.id, entry]));
      const globalPreferences = all
        .filter((result) => eligible(result) && result.memory.node.type === "preference")
        .flatMap((result) => projectMemOSEvent(result, identity))
        .map((entry) => {
          const queried = queryById.get(entry.id);
          return {
            ...(queried ?? entry),
            // Global eligibility does not assert relevance to the current request.
            score: agentMemoryQualityWeight((queried ?? entry).quality),
            matchedBy: [...(queried ?? entry).matchedBy, "global_preference"],
          };
        });
      background.globalPreferenceCandidates = globalPreferences.length;
      // A matched preference replaces its catalog projection, never the reverse.
      const merged = new Map<string, AgentContinuityEventCandidate>(
        [...globalPreferences, ...assessed].map((entry) => [entry.id, entry]),
      );
      if (diagnostics.relevanceStatus === "completed")
        diagnostics.irrelevant = candidates.filter((entry) => !merged.has(entry.id)).length;
      candidateCounts = {
        available: new Set([
          ...all
            .filter((result) => eligible(result) && result.memory.node.type === "preference")
            .map((entry) => entry.memory.node.id),
          ...candidates.map((entry) => entry.id),
        ]).size,
        matched: merged.size,
      };
      const budgeted = applyAgentContinuityPromptBudget(
        {
          events: [...merged.values()],
          pinnedEvents: assessed
            .slice()
            .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)),
          historicalTokenBudget: longTermBudget,
          diaryIndex,
          snapshotGeneration: generation,
        },
        this.options.recallConfig().PromptBudget,
      );
      entries = budgeted.events.map((entry) => snapshotEntryFromCandidate({ ...entry, reserved: true }));
      if (!isCurrent()) return undefined;
      // A successful empty selection is still the background for this boundary.
      // Later learning belongs to the next session or compaction, not a new
      // system prefix midway through the current generation. Failed recalls
      // and relevance assessments remain retryable instead of freezing absence.
      if (
        freezeForSession &&
        input.sessionId &&
        background.status === "completed" &&
        diagnostics.relevanceStatus !== "unavailable"
      ) {
        throwAbortReason(input.signal);
        const snapshot = this.options.store.createMemorySnapshot(
          input.sessionId,
          { entries, diaryIndex: frozenDiaryIndex },
          new Date().toISOString(),
        );
        entries = snapshot.entries;
        frozenDiaryIndex = snapshot.diaryIndex;
        diaryIndex = projectDiaryIndex();
      }
    }
    throwAbortReason(input.signal);
    const frozenCount = entries.length;
    const selected = applyAgentContinuityPromptBudget(
      {
        events: entries.map((entry) => projectSnapshotEntry(entry, identity)),
        pinnedEvents: entries.filter((entry) => entry.reserved).map((entry) => projectSnapshotEntry(entry, identity)),
        historicalTokenBudget: longTermBudget,
        diaryIndex,
        snapshotGeneration: generation,
      },
      this.options.recallConfig().PromptBudget,
    );
    const selectedIds = new Set(selected.events.map((entry) => entry.id));
    entries = entries.filter((entry) => selectedIds.has(entry.id));
    const backgroundSelection = snapshotSelection(entries, budget, diaryIndex, generation);
    const taskRead = await this.readRecall("task", input, () =>
      task && this.options.memos.taskMemory
        ? this.options.memos.taskMemory(task.taskId, input.userInput, input.sessionId)
        : Promise.resolve([]),
    );
    const taskResults = taskRead.results.filter(
      (result) =>
        !ledger ||
        agentMemorySubjectOwns(subject, readAgentMemOSSemanticMetadata(result.memory.node)?.senera_subject_id),
    );
    const { newest, oldest } = taskResults.reduce(
      (range, result) => {
        const occurredAt = Date.parse(projectAgentMemOSOccurredAt(result.memory.node));
        return { newest: Math.max(range.newest, occurredAt), oldest: Math.min(range.oldest, occurredAt) };
      },
      { newest: -Infinity, oldest: Infinity },
    );
    const dynamicBudget = { ...budget, maxTokens: Math.max(0, budget.maxTokens - backgroundSelection.usedTokens) };
    const taskCandidates = taskResults.flatMap((result) => projectTaskEvent(result, identity, oldest, newest));
    const taskIds = new Set(taskCandidates.map((entry) => entry.id));
    const measureDynamic = (events: readonly AgentContinuityEventCandidate[]) =>
      renderAgentDynamicMemoryWire(
        {
          ...EmptyAgentContinuityMemoryPromptContext,
          enabled: true,
          taskCandidates: events.filter((entry) => taskIds.has(entry.id)),
          relatedCandidates: events.filter((entry) => !taskIds.has(entry.id)),
        },
        budget,
      ).tokenCount;
    const taskMemory = applyAgentContinuityPromptBudget(
      {
        events: taskCandidates,
        measureTokens: measureDynamic,
        historicalTokenBudget: {
          ...dynamicBudget,
          maxTokens: Math.min(dynamicBudget.maxTokens, Math.floor(budget.maxTokens * ratios.TaskBudgetRatio)),
        },
      },
      this.options.recallConfig().PromptBudget,
    );
    const relatedStartedAt = performance.now();
    const deliveredVersions = new Set(
      [...entries, ...taskMemory.events].map((entry) => `${entry.id}@${entry.revision}`),
    );
    const relatedCandidates = queryResults
      .filter(
        (result) =>
          (!ledger ||
            agentMemorySubjectOwns(subject, readAgentMemOSSemanticMetadata(result.memory.node)?.senera_subject_id)) &&
          !deliveredVersions.has(`${result.memory.node.id}@${agentMemOSRevision(result.memory.node)}`) &&
          !(
            result.memory.node.type === "context" &&
            readAgentMemOSSemanticMetadata(result.memory.node)?.senera_task_id === task?.taskId
          ),
      )
      .flatMap((result) => projectMemOSEvent(result, identity))
      .map((entry) => ({
        ...entry,
        matchedBy: [...entry.matchedBy, entry.type === "context" ? "historical_task" : "related_knowledge"],
      }));
    let relatedStatus: "not_needed" | "completed" | "unavailable" =
      queryRead.status === "unavailable" ? "unavailable" : "not_needed";
    let assessedRelated: readonly AgentContinuityEventCandidate[] = [];
    if (relatedCandidates.length) {
      try {
        assessedRelated = await this.options.assessRelevance({
          query: input.userInput,
          candidates: relatedCandidates,
          signal: input.signal,
        });
        relatedStatus = "completed";
      } catch (error) {
        throwAbortReason(input.signal);
        if (error instanceof AgentCancellationError) throw error;
        relatedStatus = "unavailable";
        this.options.logger?.warn("memory.memos.related_recall_failed", {
          sessionId: input.sessionId,
          requestId: input.requestId,
          message: errorMessage(error),
        });
      }
    }
    const relatedMemory = applyAgentContinuityPromptBudget(
      {
        events: [...taskCandidates, ...assessedRelated],
        pinnedEvents: taskMemory.events,
        measureTokens: measureDynamic,
        historicalTokenBudget: dynamicBudget,
      },
      policy.PromptBudget,
    );
    const selectedTasks = relatedMemory.events.filter((entry) => taskIds.has(entry.id));
    const relatedEvents = relatedMemory.events.filter((entry) => !taskIds.has(entry.id));
    throwAbortReason(input.signal);
    if (!isCurrent()) return undefined;
    if (freezeForSession && input.sessionId && input.requestId && ledger) {
      ledger.stageDelivery(input.sessionId, input.requestId, entries, "snapshot");
      ledger.stageDelivery(input.sessionId, input.requestId, relatedMemory.events, "task");
    }
    const currentQuality = ledger
      ? Object.fromEntries([...entries, ...relatedMemory.events].map((entry) => [entry.id, ledger.quality(entry.id)]))
      : undefined;
    return {
      enabled: true,
      ...(input.userInput.trim() ? { query: input.userInput.trim() } : {}),
      eventCandidates: entries.map((entry) => projectSnapshotEntry(entry, identity)),
      taskCandidates: selectedTasks,
      relatedCandidates: relatedEvents,
      diaryIndex,
      ...(input.sessionId ? { snapshotGeneration: this.options.store.snapshotGeneration(input.sessionId) } : {}),
      diagnostics,
      retrieval: {
        totalLatencyMs: performance.now() - startedAt,
        background,
        task: { latencyMs: taskRead.latencyMs, candidates: taskResults.length, status: taskRead.status },
        related: {
          latencyMs: queryRead.latencyMs + performance.now() - relatedStartedAt,
          candidates: relatedCandidates.length,
          status: relatedStatus,
        },
      },
      ...(currentQuality ? { currentQuality } : {}),
      selection: {
        ...backgroundSelection,
        events: {
          available: candidateCounts?.available ?? frozenCount,
          matched: candidateCounts?.matched ?? frozenCount,
          selected: entries.length,
        },
        tasks: { available: taskCandidates.length, matched: taskCandidates.length, selected: selectedTasks.length },
        related: {
          available: relatedCandidates.length,
          matched: assessedRelated.length,
          selected: relatedEvents.length,
        },
        usedTokens: backgroundSelection.usedTokens + relatedMemory.selection.usedTokens,
      },
    };
  }

  private async readRecall(
    stage: string,
    input: RecallInput,
    read: () => Promise<AgentContinuityMemOSSearchResult[]>,
  ): Promise<{ results: AgentContinuityMemOSSearchResult[]; latencyMs: number; status: "completed" | "unavailable" }> {
    const startedAt = performance.now();
    try {
      return { results: await read(), latencyMs: performance.now() - startedAt, status: "completed" };
    } catch (error) {
      throwAbortReason(input.signal);
      if (error instanceof AgentCancellationError) throw error;
      this.options.logger?.warn("memory.memos.recall_failed", {
        stage,
        sessionId: input.sessionId,
        requestId: input.requestId,
        message: errorMessage(error),
      });
      return { results: [], latencyMs: performance.now() - startedAt, status: "unavailable" };
    }
  }

  private empty(userInput: string): AgentContinuityMemoryPromptContext {
    return {
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      ...(userInput.trim() ? { query: userInput.trim() } : {}),
    };
  }

  private snapshotEpoch(sessionId: string): number {
    return this.snapshotEpochs.get(sessionId) ?? 0;
  }

  private advanceSnapshotEpoch(sessionId: string): void {
    this.snapshotEpochs.set(sessionId, this.snapshotEpoch(sessionId) + 1);
  }
}

function snapshotEntryFromCandidate(
  entry: AgentContinuityMemoryPromptContext["eventCandidates"][number],
): AgentContinuityMemorySnapshotEntry {
  return {
    id: entry.id,
    revision: entry.revision,
    type: entry.type,
    summary: entry.summary,
    occurredAt: entry.occurredAt,
    score: entry.score,
    matchedBy: [...entry.matchedBy],
    ...(entry.scores ? { scores: entry.scores } : {}),
    ...(entry.reserved ? { reserved: true } : {}),
    ...(entry.quality ? { quality: entry.quality } : {}),
    ...(entry.retention ? { retention: entry.retention } : {}),
  };
}

function projectSnapshotEntry(
  entry: AgentContinuityMemorySnapshotEntry,
  identity: AgentIdentityDisplayValues | undefined,
): AgentContinuityMemoryPromptContext["eventCandidates"][number] {
  return {
    id: entry.id,
    uri: agentMemOSReference(entry.id),
    revision: entry.revision,
    type: entry.type,
    summary: projectAgentMemOSSemanticIdentityText(entry.summary, identity),
    occurredAt: entry.occurredAt,
    score: entry.score,
    matchedBy: entry.matchedBy,
    ...(entry.scores ? { scores: entry.scores } : {}),
    ...(entry.reserved ? { reserved: true } : {}),
    ...(entry.quality ? { quality: entry.quality } : {}),
    ...(entry.retention ? { retention: entry.retention } : {}),
  };
}

function snapshotSelection(
  entries: readonly AgentContinuityMemorySnapshotEntry[],
  budget: AgentContinuityHistoricalTokenBudget,
  diaryIndex: string,
  snapshotGeneration: number,
): AgentContinuityMemoryPromptContext["selection"] {
  return {
    events: { available: entries.length, matched: entries.length, selected: entries.length },
    usedTokens: renderAgentContinuityPromptWire(
      {
        ...EmptyAgentContinuityMemoryPromptContext,
        enabled: true,
        eventCandidates: entries.map((entry) => projectSnapshotEntry(entry, undefined)),
        diaryIndex,
        snapshotGeneration,
      },
      { estimateTokens: budget.estimateTokens },
    ).tokenCount,
    maxTokens: budget.maxTokens,
  };
}

function projectMemOSEvent(
  result: AgentContinuityMemOSSearchResult,
  identity: AgentIdentityDisplayValues | undefined,
): AgentContinuityMemoryPromptContext["eventCandidates"][number][] {
  const node = result.memory.node;
  if (!isAgentMemOSAutomaticPromptMemory(node)) return [];
  return [
    {
      id: node.id,
      uri: agentMemOSReference(node.id),
      revision: agentMemOSRevision(node),
      type: node.type,
      summary: projectAgentMemOSSemanticIdentityText(AgentMemOSSummarySchema.parse(node.summary), identity),
      occurredAt: projectAgentMemOSOccurredAt(node),
      score: agentMemoryRelevance(result.memory) * agentMemoryQualityWeight(result.quality),
      ...(result.quality ? { quality: result.quality } : {}),
      ...(result.retention ? { retention: result.retention } : {}),
      matchedBy: ["memos", ...Object.keys(result.memory.scores ?? {})],
      ...(result.memory.scores ? { scores: { ...result.memory.scores } } : {}),
      dedupeKeys: result.dedupeKeys,
    },
  ];
}

function projectTaskEvent(
  result: AgentContinuityMemOSSearchResult,
  identity: AgentIdentityDisplayValues | undefined,
  oldest: number,
  newest: number,
): AgentContinuityMemoryPromptContext["eventCandidates"][number][] {
  const node = result.memory.node;
  if (node.type !== "context") return [];
  const occurredAt = projectAgentMemOSOccurredAt(node);
  const recency = newest === oldest ? 1 : (Date.parse(occurredAt) - oldest) / (newest - oldest);
  const relevance = Math.max(0, Math.min(1, agentMemoryRelevance(result.memory)));
  // Task membership is the eligibility boundary. Within it, current relevance,
  // Task progress and query relevance remain visible alongside the ledger's weight.
  const score = (relevance + recency + agentMemoryQualityWeight(result.quality)) / 3;
  return [
    {
      id: node.id,
      uri: agentMemOSReference(node.id),
      revision: agentMemOSRevision(node),
      type: "context",
      summary: projectAgentMemOSSemanticIdentityText(AgentMemOSSummarySchema.parse(node.summary), identity),
      occurredAt,
      score,
      scores: { ...result.memory.scores, relevance, recency },
      ...(result.quality ? { quality: result.quality } : {}),
      ...(result.dedupeKeys ? { dedupeKeys: result.dedupeKeys } : {}),
      matchedBy: ["current_task"],
      ...(result.retention ? { retention: result.retention } : {}),
    },
  ];
}
