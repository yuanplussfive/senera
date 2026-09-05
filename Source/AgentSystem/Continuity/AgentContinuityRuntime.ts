import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { AgentContinuityLearningRuntime } from "./AgentContinuityLearningRuntime.js";
import { AgentContinuityMemoryService } from "./AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import { AgentContinuityStableSnapshotStore } from "./AgentContinuityStableSnapshotStore.js";
import { AgentMemoryDatabaseContract } from "../Memory/AgentMemorySqlSchema.js";
import { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import { SqliteAgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentUpgradeSession } from "../Upgrade/AgentUpgradeSession.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentEventSink } from "../Events/AgentEventTypes.js";
import { AgentExecutionLedgerService } from "../Goals/AgentExecutionLedgerService.js";
import { AgentExecutionLedgerSqliteStore } from "../Goals/AgentExecutionLedgerSqliteStore.js";
import { AgentTodoService } from "../Todos/AgentTodoService.js";
import { AgentTodoSqliteStore } from "../Todos/AgentTodoSqliteStore.js";
import type { AgentTodoPolicy } from "../Todos/AgentTodoTypes.js";
import { AgentResidentProfileService } from "../Profile/AgentResidentProfileService.js";
import { resolveAgentWorldConfig, resolveContinuityLearningConfig } from "../AgentDefaults.js";
import { AgentResidentProfileSqliteStore } from "../Profile/AgentResidentProfileSqliteStore.js";
import { resolveAgentContinuityRuleConsolidationPolicy } from "./AgentContinuityRuleConsolidationPolicy.js";
import { decideAgentContinuityLearning } from "./AgentContinuityLearningGate.js";
import { AgentContinuityLifecycleCoordinator, type AgentContinuityLifecyclePort } from "./AgentContinuityLifecycle.js";
import { AgentContinuitySemanticRecall } from "./AgentContinuitySemanticRecall.js";
import type { AgentContinuitySemanticEmbeddingClient } from "./AgentContinuitySemanticRecall.js";
import { agentContinuityObservationUri } from "./AgentContinuityObservationProjection.js";
import { AgentTurnValueClassifier } from "./AgentTurnValueClassifier.js";
import { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../Agenda/AgentAgendaSqliteStore.js";
import { AgentAgendaLearningBridge } from "../Agenda/AgentAgendaLearningBridge.js";
import { AgentContinuityIdentityStore, type AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import { AgentTemporalMemorySqliteStore } from "../TemporalMemory/AgentTemporalMemorySqliteStore.js";
import { AgentTemporalMemoryRuntime } from "../TemporalMemory/AgentTemporalMemoryRuntime.js";
import { AgentTemporalMemorySummaryModelClient } from "../TemporalMemory/AgentTemporalMemorySummaryModelClient.js";
import { AgentConversationBoundaryModelClient } from "../TemporalMemory/AgentConversationBoundaryModelClient.js";
import { projectAgentTemporalMemoryScope } from "../TemporalMemory/AgentTemporalMemoryIdentity.js";
import type { AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";

export interface AgentContinuityRuntime {
  readonly database: AgentSqliteDatabaseKernel;
  readonly store: AgentContinuitySqliteStore;
  readonly learning: AgentContinuityLearningRuntime;
  readonly memory: AgentMemoryService;
  readonly promptContext: AgentContinuityMemoryService;
  readonly residentProfile: AgentResidentProfileService;
  readonly identity: AgentContinuityIdentityContext;
  readonly agenda: AgentAgendaService;
  readonly executionLedger: AgentExecutionLedgerService;
  readonly todos: AgentTodoService;
  readonly lifecycle: AgentContinuityLifecyclePort;
  readonly temporalMemory: AgentTemporalMemoryRuntime;
  readonly temporalMemoryStore: AgentTemporalMemorySqliteStore;
  /** Wires recall observability; may be attached once the broadcast server exists. */
  setEventSink(sink: AgentEventSink): void;
  close(): Promise<void>;
}

export function createAgentContinuityRuntime(input: {
  readonly databasePath: string;
  readonly identityPath: string;
  readonly upgradeSession: AgentUpgradeSession;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly todoPolicy: AgentTodoPolicy;
  /** Optional shared embedding client; semantic recall stays off without one. */
  readonly embeddingClient?: AgentContinuitySemanticEmbeddingClient;
  readonly embeddingModel?: () => string;
  readonly identityTemplateValues?: () => AgentIdentityTemplateValues;
  /** Optional stream of continuity domain events (recall observability). */
  readonly eventSink?: AgentEventSink;
  readonly logger?: AgentLogger;
  /** Optional shared budget for background continuity inference. */
  readonly inferenceBudget?: AgentInferenceBudgetPort;
}): AgentContinuityRuntime {
  const database = new AgentSqliteDatabaseKernel({
    databasePath: input.databasePath,
    contract: AgentMemoryDatabaseContract,
    upgradeSession: input.upgradeSession,
  });
  try {
    const sourceRepository = new SqliteAgentMemorySourceRepository(database);
    const store = new AgentContinuitySqliteStore(database, undefined, {
      factReconciliationPolicy: () => resolveContinuityLearningConfig(input.configSnapshot()).Recall.Ranking,
      consolidationPolicy: () =>
        resolveAgentContinuityRuleConsolidationPolicy(
          resolveContinuityLearningConfig(input.configSnapshot()).Recall.Ranking.Consolidation,
        ),
    });
    const turnValueClassifier = new AgentTurnValueClassifier();
    store.reconcileAllFacts();
    const completedEpisodes = sourceRepository.listCompletedEpisodes();
    const physicalObservationUris = sourceRepository
      .listSourcesForEpisodes(completedEpisodes.map((episode) => episode.uri))
      .map((source) => agentContinuityObservationUri(source.uri));
    const prunedEmbeddings = store.pruneObservationEmbeddings(physicalObservationUris);
    if (prunedEmbeddings > 0) {
      input.logger?.info("continuity.semantic.embeddings_pruned", { count: prunedEmbeddings });
    }
    const semanticRecall = new AgentContinuitySemanticRecall({
      store,
      client: input.embeddingClient,
      model: input.embeddingModel ?? (() => ""),
      scoreFloor: () => resolveContinuityLearningConfig(input.configSnapshot()).Recall.Semantic.ScoreFloor,
      logger: input.logger,
    });
    const stableSnapshotStore = new AgentContinuityStableSnapshotStore(database);
    const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) });
    const agendaWorld = agenda.snapshot(resolveAgentWorldConfig(input.configSnapshot()).TimeZone).world;
    const identity = new AgentContinuityIdentityStore(input.identityPath).context({ worldId: agendaWorld.id });
    const temporalMemoryScope = projectAgentTemporalMemoryScope(identity);
    const temporalMemoryStore = new AgentTemporalMemorySqliteStore(database);
    const temporalMemory = new AgentTemporalMemoryRuntime({
      store: temporalMemoryStore,
      sources: sourceRepository,
      identity,
      timeZone: () => resolveAgentWorldConfig(input.configSnapshot()).TimeZone,
      policy: () => {
        const continuity = resolveContinuityLearningConfig(input.configSnapshot());
        return {
          enabled: continuity.Enabled && continuity.TemporalMemory.Enabled,
          maxAttempts: continuity.Runtime.MaxAttempts,
          retryBaseMs: continuity.Runtime.RetryBaseDelaySeconds * 1_000,
          retryMaxDelayMs: continuity.Runtime.RetryMaxDelaySeconds * 1_000,
          maxJobsPerDrain: continuity.Runtime.MaxJobsPerDrain,
        };
      },
      boundaryClient: () =>
        new AgentConversationBoundaryModelClient(
          resolveContinuityLearningConfig(input.configSnapshot()).Client.ModelProvider,
          temporalMemoryScope.key,
        ),
      boundaryAnchors: () => {
        const snapshot = agenda.snapshot(resolveAgentWorldConfig(input.configSnapshot()).TimeZone);
        return [...snapshot.activeGoals, ...snapshot.currentActivities, ...snapshot.upcoming].map(
          (record) => record.summary,
        );
      },
      summaryClient: () =>
        new AgentTemporalMemorySummaryModelClient(
          resolveContinuityLearningConfig(input.configSnapshot()).Client.ModelProvider,
          temporalMemoryScope.key,
        ),
      logger: input.logger,
    });
    const agendaLearning = new AgentAgendaLearningBridge(agenda);
    const executionLedger = new AgentExecutionLedgerService({
      store: new AgentExecutionLedgerSqliteStore(database),
    });
    const todos = new AgentTodoService({ store: new AgentTodoSqliteStore(database), policy: input.todoPolicy });
    const residentProfileStore = new AgentResidentProfileSqliteStore(database, undefined, {
      consolidationPolicy: () =>
        resolveAgentContinuityRuleConsolidationPolicy(
          resolveContinuityLearningConfig(input.configSnapshot()).Recall.Ranking.Consolidation,
        ),
    });
    residentProfileStore.reconcileLegacyLedger();
    const residentProfile = new AgentResidentProfileService({
      store: residentProfileStore,
    });
    const promptContext = new AgentContinuityMemoryService({
      identity,
      store,
      sourceRepository,
      temporalMemoryStore,
      identityTemplateValues: input.identityTemplateValues,
      residentProfile,
      stableSnapshotStore,
      recallConfig: () => resolveContinuityLearningConfig(input.configSnapshot()).Recall,
      semanticRecall,
      turnValueClassification: (userInput) => {
        const gate = resolveContinuityLearningConfig(input.configSnapshot()).Recall.TurnValueClassifier;
        return turnValueClassifier.classify(userInput, store.listTurnValueTrainingExamples(), {
          enabled: gate.Enabled,
          confidenceThreshold: gate.ConfidenceThreshold,
          minimumExamplesPerLabel: gate.MinimumExamplesPerLabel,
        });
      },
      eventSink: input.eventSink,
      logger: input.logger,
    });
    const learning = new AgentContinuityLearningRuntime({
      sourceRepository,
      store,
      identity,
      configSnapshot: input.configSnapshot,
      residentProfile,
      agendaLearning,
      agendaTimeZone: () => resolveAgentWorldConfig(input.configSnapshot()).TimeZone,
      logger: input.logger,
      rulesSnapshot: (snapshotInput) => promptContext.rulesSnapshot(snapshotInput),
      semanticRecall,
      inferenceBudget: input.inferenceBudget,
      runtimePolicy: () => {
        const runtime = resolveContinuityLearningConfig(input.configSnapshot()).Runtime;
        return {
          maxAttempts: runtime.MaxAttempts,
          retryBaseMs: runtime.RetryBaseDelaySeconds * 1_000,
          retryMaxDelayMs: runtime.RetryMaxDelaySeconds * 1_000,
          maxJobsPerDrain: runtime.MaxJobsPerDrain,
        };
      },
    });
    learning.setEventSink(input.eventSink);
    const memory = new AgentMemoryService({
      sourceRepository,
      continuityLearning: learning,
      temporalMemory,
      completedTurnSinkFailure: ({ error }) =>
        input.logger?.warn("memory.completed_turn_sink.failed", {
          error: errorMessage(error),
        }),
      continuityLearningGate: (recordedTurn) => {
        const resolved = resolveContinuityLearningConfig(input.configSnapshot());
        const gate = resolved.Recall.TurnValueClassifier;
        const classification = turnValueClassifier.classify(
          recordedTurn.episode.rawUserText,
          store.listTurnValueTrainingExamples(),
          {
            enabled: gate.Enabled,
            confidenceThreshold: gate.ConfidenceThreshold,
            minimumExamplesPerLabel: gate.MinimumExamplesPerLabel,
          },
        );
        const decision = decideAgentContinuityLearning(
          recordedTurn,
          {
            enabled: resolved.LearningGate.Enabled,
            deferredDelayMs: resolved.LearningGate.DeferredDelaySeconds * 1_000,
            turnValueClassifierEnabled: gate.Enabled,
          },
          classification,
        );
        if (decision.mode === "skip") {
          input.logger?.info("continuity.learning.skipped", {
            requestId: recordedTurn.episode.requestId,
            episodeUri: recordedTurn.episode.uri,
            reason: decision.reason,
          });
        } else if (decision.mode === "deferred") {
          input.logger?.info("continuity.learning.deferred", {
            requestId: recordedTurn.episode.requestId,
            episodeUri: recordedTurn.episode.uri,
            reason: decision.reason,
            deferredUntilMs: decision.deferredUntilMs,
          });
        }
        return decision;
      },
      continuityDelivery: promptContext,
      continuityPrefetch: (sessionId) => promptContext.prefetch({ sessionId }),
      continuityPrefetchFailure: ({ sessionId, error }) => {
        input.logger?.warn("continuity.prefetch.failed", {
          sessionId,
          message: errorMessage(error),
        });
      },
      deletionSinks: [store, residentProfile, promptContext, learning, temporalMemory],
    });
    const lifecycle = new AgentContinuityLifecycleCoordinator({ memory, promptContext });
    return {
      database,
      store,
      learning,
      memory,
      promptContext,
      residentProfile,
      identity,
      agenda,
      executionLedger,
      todos,
      lifecycle,
      temporalMemory,
      temporalMemoryStore,
      setEventSink: (sink) => {
        promptContext.setEventSink(sink);
        learning.setEventSink(sink);
      },
      close: async () => {
        try {
          await lifecycle.close();
          await learning.flushEmbeddings();
        } finally {
          database.close();
        }
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
