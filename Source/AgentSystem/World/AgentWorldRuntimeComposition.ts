import type { AgentChannelProactiveDeliveryRequest } from "../Channels/AgentChannelService.js";
import { AgentContinuityEventBridge } from "../Continuity/AgentContinuityEventBridge.js";
import type { AgentContinuityRuntime } from "../Continuity/AgentContinuityRuntime.js";
import { listAgentContinuityAutomaticRecallScopes } from "../Continuity/AgentContinuityScopes.js";
import { AgentNativeToolApiByEndpoint } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import type { AgentConversationEntryMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentOrchestrationEventRelay } from "../Orchestration/AgentOrchestrationEventRelay.js";
import type { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentGoalCommandService } from "../Agenda/AgentGoalCommandService.js";
import type { AgentGoalMicroLoopDispatchActionPort } from "../Agenda/AgentGoalMicroLoopDispatchActionPort.js";
import { AgentGoalMicroLoopModelDecisionPort } from "../Agenda/AgentGoalMicroLoopModelDecisionPort.js";
import { AgentGoalMicroLoopRuntime } from "../Agenda/AgentGoalMicroLoopRuntime.js";
import { createAgentGoalMicroLoopCacheOptions } from "../Agenda/AgentGoalMicroLoopPromptCache.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentPresetWorldActivationRuntime } from "./AgentPresetWorldActivationRuntime.js";
import type { AgentRunDispatchGateway } from "../Orchestration/AgentRunDispatchPort.js";
import { AgentSessionStatuses } from "../Session/AgentSession.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentTemporalMemoryWorldBridge } from "./AgentTemporalMemoryWorldBridge.js";
import { AgentWorldAutonomyRuntime } from "./AgentWorldAutonomyRuntime.js";
import { AgentWorldActionSourceIds } from "./AgentWorldActionBudget.js";
import { AgentWorldConversationBridge } from "./AgentWorldConversationBridge.js";
import { AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import { AgentWorldHabitRuntime } from "./AgentWorldHabitRuntime.js";
import { AgentWorldLifecycleEventBridge } from "./AgentWorldLifecycleEventBridge.js";
import { AgentWorldMaterializer } from "./AgentWorldMaterializer.js";
import { AgentWorldPackageLoader } from "./AgentWorldPackageLoader.js";
import { AgentWorldResidentIdleAgendaActionPort } from "./AgentWorldResidentIdleActionPort.js";
import { AgentWorldResidentIdleModelDecisionPort } from "./AgentWorldResidentIdleModelDecisionPort.js";
import { AgentWorldResidentIdleRuntime } from "./AgentWorldResidentIdleRuntime.js";
import { AgentWorldResidentWakeEventActionPort } from "./AgentWorldResidentWakeEventActionPort.js";
import {
  AgentWorldResidentWakeRuntime,
  type AgentWorldResidentWakeActionPort,
} from "./AgentWorldResidentWakeRuntime.js";
import { AgentWorldRuntime } from "./AgentWorldRuntime.js";
import { AgentWorldWorkLedger } from "./AgentWorldWorkLedger.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import { AgentHabitScheduler } from "./AgentHabitScheduler.js";
import { AgentResidentStateMachine } from "./AgentResidentStateMachine.js";
import { AgentWorldClock } from "./AgentWorldClock.js";
import {
  resolveActionPlannerConfig,
  resolveAgentWorldConfig,
  resolveModelProviderConfig,
  resolvePresetsConfig,
} from "../AgentDefaults.js";
import { secondsToMilliseconds } from "../Defaults/AgentTimeDefaults.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentEventSink } from "../Events/AgentEventTypes.js";
import { createAgentResidentIdleCacheOptions } from "./AgentWorldResidentIdlePromptCache.js";

type ResidentSession = { readonly sessionId: string; readonly status: string; readonly updatedAt: string };

export interface AgentWorldRuntimeCompositionOptions {
  readonly workspaceRoot: string;
  readonly worldPackagesRoot: string;
  readonly initialConfig: AgentSystemConfig;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly logger: AgentLogger;
  readonly continuityRuntime: AgentContinuityRuntime;
  readonly runDispatch: AgentRunDispatchGateway;
  readonly orchestrationEvents: AgentOrchestrationEventRelay;
  readonly goalMicroLoopActionPort: AgentGoalMicroLoopDispatchActionPort;
  readonly goalModelProvider: ReturnType<typeof resolveModelProviderConfig>;
  readonly goalPlannerModelClient: AgentActionPlannerModelClient;
  readonly inferenceBudget: AgentInferenceBudgetPort;
  readonly goalMicroLoopConfig: () => ReturnType<typeof resolveAgentWorldConfig>["GoalMicroLoop"];
  readonly residentIdleConfig: () => ReturnType<typeof resolveAgentWorldConfig>["ResidentIdle"];
  readonly residentInteractionTarget?: (
    sessions: readonly ResidentSession[],
  ) => string | undefined | Promise<string | undefined>;
  readonly listResidentSessions: () => readonly ResidentSession[];
  readonly residentWakeAction?: AgentWorldResidentWakeActionPort;
  readonly deliverProactiveResult: (
    request: AgentChannelProactiveDeliveryRequest,
  ) => Promise<"delivered" | "busy" | "missing">;
  readonly deliverResidentMessage: (request: {
    readonly deliveryId: string;
    readonly sessionId: string;
    readonly content: string;
    readonly createdAt: string;
    readonly metadata?: AgentConversationEntryMetadata;
    readonly onEvent?: AgentEventSink;
  }) => Promise<"delivered" | "busy" | "missing">;
  readonly identityTemplateValues: () => import("../Prompt/AgentIdentityTemplate.js").AgentIdentityTemplateValues;
}

export interface AgentWorldRuntimeComposition {
  readonly agenda: AgentAgendaService;
  readonly goalCommands: AgentGoalCommandService;
  readonly worldRuntime: AgentWorldRuntime;
  readonly residentIdle: AgentWorldResidentIdleRuntime;
  readonly residentWake: AgentWorldResidentWakeRuntime;
  readonly presetActivation: import("./AgentPresetWorldActivationRuntime.js").AgentPresetWorldActivationRuntime;
  readonly activePresetCard: Awaited<ReturnType<AgentPresetManager["synchronizeActivePreset"]>>;
  readonly temporalMemoryWorldBridge: AgentTemporalMemoryWorldBridge;
  readonly requestWorldWake: (reason: string) => void;
  readonly observeWorldAndContinuityEvent: (event: import("../Events/AgentEventTypes.js").AgentDomainEvent) => void;
}

export async function composeAgentWorldRuntime(
  options: AgentWorldRuntimeCompositionOptions,
): Promise<AgentWorldRuntimeComposition> {
  const { continuityRuntime } = options;
  const { agenda, memory: memoryService } = continuityRuntime;
  const worldLedger = new AgentWorldEventLedger(continuityRuntime.database, agenda);
  const worldMaterializer = new AgentWorldMaterializer({
    ledger: worldLedger,
    graphSnapshot: () =>
      continuityRuntime.store.graphSnapshot(listAgentContinuityAutomaticRecallScopes(continuityRuntime.identity)),
    config: () => resolveAgentWorldConfig(options.configSnapshot()),
    identityTemplateValues: options.identityTemplateValues,
  });
  const worldClock = new AgentWorldClock(continuityRuntime.database, worldLedger);
  const worldResidentStates = new AgentResidentStateMachine(continuityRuntime.database, worldLedger);
  const worldHabits = new AgentHabitScheduler(
    continuityRuntime.database,
    worldLedger,
    { read: (subjectId, attribute, at) => worldMaterializer.readAttribute(subjectId, attribute, at) },
    worldResidentStates,
  );
  const worldWorkLedger = new AgentWorldWorkLedger(continuityRuntime.database);
  const goalMicroLoop = createGoalMicroLoop(options, worldWorkLedger);
  const residentIdle = createResidentIdle(options, worldWorkLedger);
  const worldAutonomy = new AgentWorldAutonomyRuntime({
    habits: worldHabits,
    config: () => resolveAgentWorldConfig(options.configSnapshot()),
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.LeaseDurationSeconds,
    ),
    retryDelayMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.RetryDelaySeconds,
    ),
  });
  const worldHabitRuntime = new AgentWorldHabitRuntime({
    habits: worldHabits,
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.LeaseDurationSeconds,
    ),
    retryDelayMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.RetryDelaySeconds,
    ),
  });
  const worldPackageLoader = new AgentWorldPackageLoader({
    workspaceRoot: options.workspaceRoot,
    rootDir: options.worldPackagesRoot,
    database: continuityRuntime.database,
    agenda,
    ledger: worldLedger,
    residentStates: worldResidentStates,
    habits: worldHabits,
    autonomy: worldAutonomy,
    config: () => resolveAgentWorldConfig(options.configSnapshot()),
  });
  const residentWake = new AgentWorldResidentWakeRuntime({
    workLedger: worldWorkLedger,
    actionPort:
      options.residentWakeAction ??
      new AgentWorldResidentWakeEventActionPort({
        ledger: worldLedger,
        timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
      }),
    maxPending: Math.max(1, resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.MaxActionsPerWake),
    leaseDurationMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.LeaseDurationSeconds,
    ),
    retryDelayMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.RetryDelaySeconds,
    ),
  });
  const presetActivation = new AgentPresetWorldActivationRuntime(worldPackageLoader);
  const startupPresetManager = new AgentPresetManager({
    workspaceRoot: options.workspaceRoot,
    config: resolvePresetsConfig(options.configSnapshot()),
    activation: presetActivation,
  });
  const activePresetCard = await startupPresetManager.synchronizeActivePreset();
  const worldRuntime = new AgentWorldRuntime({
    agenda,
    ledger: worldLedger,
    clock: worldClock,
    habits: worldHabits,
    residentStates: worldResidentStates,
    materializer: worldMaterializer,
    config: () => resolveAgentWorldConfig(options.configSnapshot()),
    errorSink: (error) => options.logger.error("世界运行时推进失败", { error: errorMessage(error) }),
    wakeSources: [worldHabitRuntime, worldAutonomy, goalMicroLoop, residentWake, residentIdle],
    workLedger: worldWorkLedger,
    inferenceBudget: options.inferenceBudget,
    inferenceBudgetScope: () => continuityRuntime.identity.workspaceId,
  });
  const requestWorldWake = (reason: string): void => {
    void worldRuntime
      .wake()
      .catch((error) => options.logger.warn("世界事件唤醒失败", { reason, error: errorMessage(error) }));
  };
  const temporalMemoryWorldBridge = new AgentTemporalMemoryWorldBridge({
    store: continuityRuntime.temporalMemoryStore,
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
  });
  const worldConversationBridge = new AgentWorldConversationBridge({
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
    onChanged: () => requestWorldWake("conversation_turn"),
  });
  const worldLifecycleEventBridge = new AgentWorldLifecycleEventBridge({
    ledger: worldLedger,
    agenda,
    timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
    logger: options.logger,
    onChanged: () => requestWorldWake("lifecycle_event"),
  });
  const continuityEventBridge = new AgentContinuityEventBridge({
    store: continuityRuntime.store,
    identity: continuityRuntime.identity,
    logger: options.logger,
  });
  const observeWorldAndContinuityEvent = (event: import("../Events/AgentEventTypes.js").AgentDomainEvent): void => {
    continuityEventBridge.observe(event);
    worldLifecycleEventBridge.observe(event);
  };
  memoryService.registerDeletionSink(temporalMemoryWorldBridge);
  memoryService.registerCompletedTurnSink(worldConversationBridge);
  memoryService.registerDeletionSink(worldConversationBridge);
  memoryService.registerDeletionSink(worldLifecycleEventBridge);

  return {
    agenda,
    goalCommands: new AgentGoalCommandService({
      agenda,
      timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
      reviewDelayMs: () => Math.round(options.goalMicroLoopConfig().ReviewDelaySeconds * 1_000),
    }),
    worldRuntime,
    residentIdle,
    residentWake,
    presetActivation,
    activePresetCard,
    temporalMemoryWorldBridge,
    requestWorldWake,
    observeWorldAndContinuityEvent,
  };
}

function createGoalMicroLoop(
  options: AgentWorldRuntimeCompositionOptions,
  worldWorkLedger: AgentWorldWorkLedger,
): AgentGoalMicroLoopRuntime {
  const decisionPort = new AgentGoalMicroLoopModelDecisionPort({
    client: options.goalPlannerModelClient,
    invocation: {
      cache: createAgentGoalMicroLoopCacheOptions({
        worldId: options.continuityRuntime.agenda.snapshot(resolveAgentWorldConfig(options.initialConfig).TimeZone)
          .world.id,
        provider: options.goalModelProvider.ProviderId,
        api: AgentNativeToolApiByEndpoint[options.goalModelProvider.Endpoint],
        model: options.goalModelProvider.Model,
      }),
    },
  });
  return new AgentGoalMicroLoopRuntime({
    agenda: options.continuityRuntime.agenda,
    timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
    decisionPort,
    actionPort: options.goalMicroLoopActionPort,
    failureReviewDelayMs: () => Math.round(options.goalMicroLoopConfig().ReviewDelaySeconds * 1_000),
    enabled: () =>
      options.goalMicroLoopConfig().Enabled &&
      resolveActionPlannerConfig(options.configSnapshot(), options.goalModelProvider.Id).Enabled,
    maxCandidates: () => options.goalMicroLoopConfig().MaxCandidates,
    allowedToolNames: () => options.goalMicroLoopConfig().AllowedToolNames,
    workLedger: worldWorkLedger,
    leaseDurationMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.LeaseDurationSeconds,
    ),
    retryDelayMs: secondsToMilliseconds(
      resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.RetryDelaySeconds,
    ),
  });
}

function createResidentIdle(
  options: AgentWorldRuntimeCompositionOptions,
  worldWorkLedger: AgentWorldWorkLedger,
): AgentWorldResidentIdleRuntime {
  const decisionPort = new AgentWorldResidentIdleModelDecisionPort({
    client: options.goalPlannerModelClient,
    invocation: {
      cache: createAgentResidentIdleCacheOptions({
        worldId: options.continuityRuntime.agenda.snapshot(resolveAgentWorldConfig(options.initialConfig).TimeZone)
          .world.id,
        provider: options.goalModelProvider.ProviderId,
        api: AgentNativeToolApiByEndpoint[options.goalModelProvider.Endpoint],
        model: options.goalModelProvider.Model,
      }),
    },
  });
  return new AgentWorldResidentIdleRuntime({
    workLedger: worldWorkLedger,
    decisionPort,
    actionPort: new AgentWorldResidentIdleAgendaActionPort({
      agenda: options.continuityRuntime.agenda,
      timeZone: () => resolveAgentWorldConfig(options.configSnapshot()).TimeZone,
      resolveTargetSession: async () => {
        const sessions = options.listResidentSessions();
        const selected = options.residentInteractionTarget
          ? await options.residentInteractionTarget(sessions)
          : sessions
              .filter((session) => session.status === AgentSessionStatuses.Idle)
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.sessionId;
        return selected?.trim() || undefined;
      },
      delivery: {
        deliver: async (request) => {
          const outcome = await options.deliverResidentMessage({
            ...request,
            metadata: {
              proactive: {
                sourceId: AgentWorldActionSourceIds.ResidentIdle,
                deliveryId: request.deliveryId,
              },
            },
            onEvent: (event) => options.orchestrationEvents.emit(event),
          });
          if (outcome !== "delivered") return outcome;
          return options.deliverProactiveResult(request);
        },
      },
    }),
    config: () => {
      const config = options.residentIdleConfig();
      return {
        enabled:
          config.Enabled && resolveActionPlannerConfig(options.configSnapshot(), options.goalModelProvider.Id).Enabled,
        minIntervalMs: secondsToMilliseconds(config.MinIntervalSeconds),
        maxIntervalMs: secondsToMilliseconds(config.MaxIntervalSeconds),
        backoffMultiplier: config.BackoffMultiplier,
        maxPending: config.MaxPending,
      };
    },
    leaseDurationMs: () =>
      secondsToMilliseconds(resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.LeaseDurationSeconds),
    retryDelayMs: () =>
      secondsToMilliseconds(resolveAgentWorldConfig(options.configSnapshot()).ActionBudget.RetryDelaySeconds),
  });
}
