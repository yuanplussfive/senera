import type { AgentChannelProactiveDeliveryRequest } from "../Source/AgentSystem/Channels/AgentChannelService.js";
import type { AgentContinuityRuntime } from "../Source/AgentSystem/Continuity/AgentContinuityRuntime.js";
import type { AgentEventSink } from "../Source/AgentSystem/Events/AgentEventTypes.js";
import type { AgentGoalMicroLoopDispatchActionPort } from "../Source/AgentSystem/Agenda/AgentGoalMicroLoopDispatchActionPort.js";
import type { AgentInferenceBudgetPort } from "../Source/AgentSystem/ModelEndpoints/AgentInferenceBudget.js";
import type { AgentOrchestrationEventRelay } from "../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import type { AgentRunDispatchGateway } from "../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import type { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentWorldResidentWakeActionPort } from "../Source/AgentSystem/World/AgentWorldResidentWakeRuntime.js";
import {
  composeAgentWorldRuntime,
  type AgentWorldRuntimeComposition,
} from "../Source/AgentSystem/World/AgentWorldRuntimeComposition.js";
import {
  resolveActionPlannerConfig,
  resolveAgentWorldConfig,
  resolveModelProviderConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelClient.js";
import type { AgentIdentityDisplayValues } from "../Source/AgentSystem/Text/AgentTextParts.js";

type ResidentSession = { readonly sessionId: string; readonly status: string; readonly updatedAt: string };

export interface SeneraServerWorldRuntimeInput {
  readonly workspaceRoot: string;
  readonly worldPackagesRoot: string;
  readonly initialConfig: AgentSystemConfig;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly logger: AgentLogger;
  readonly continuityRuntime: AgentContinuityRuntime;
  readonly runDispatch: AgentRunDispatchGateway;
  readonly orchestrationEvents: AgentOrchestrationEventRelay;
  readonly goalMicroLoopActionPort: AgentGoalMicroLoopDispatchActionPort;
  readonly inferenceBudget: AgentInferenceBudgetPort;
  readonly goalMicroLoopConfig: () => ReturnType<typeof resolveAgentWorldConfig>["GoalMicroLoop"];
  readonly residentIdleConfig: () => ReturnType<typeof resolveAgentWorldConfig>["ResidentIdle"];
  readonly residentInteractionTarget?: (
    sessions: readonly ResidentSession[],
  ) => string | undefined | Promise<string | undefined>;
  readonly residentSessionManagerRef: {
    current?: {
      listSessions(): readonly ResidentSession[];
      deliverProactiveMessage(request: {
        readonly deliveryId: string;
        readonly sessionId: string;
        readonly content: string;
        readonly createdAt: string;
        readonly metadata?: import("../Source/AgentSystem/ModelEndpoints/AgentModelMetadata.js").AgentConversationEntryMetadata;
        readonly onEvent?: AgentEventSink;
      }): Promise<"delivered" | "busy" | "missing">;
    };
  };
  readonly residentWakeAction?: AgentWorldResidentWakeActionPort;
  readonly channelServiceRef: {
    current?: {
      deliverProactiveResult(request: AgentChannelProactiveDeliveryRequest): Promise<"delivered" | "busy" | "missing">;
    };
  };
  readonly identityDisplayValues: () => AgentIdentityDisplayValues;
}

export async function composeSeneraServerWorldRuntime(
  input: SeneraServerWorldRuntimeInput,
): Promise<AgentWorldRuntimeComposition> {
  const goalModelProvider = resolveModelProviderConfig(input.initialConfig);
  const goalPlannerConfig = resolveActionPlannerConfig(input.initialConfig, goalModelProvider.Id);
  const goalPlannerClientConfig = goalPlannerConfig.PlanningClient;
  const goalPlannerModelClient = new AgentActionPlannerModelClient(
    goalPlannerClientConfig.ModelProvider,
    goalPlannerClientConfig,
    { maxRepairAttempts: goalPlannerConfig.MaxRepairAttempts },
  );
  const composition = await composeAgentWorldRuntime({
    workspaceRoot: input.workspaceRoot,
    worldPackagesRoot: input.worldPackagesRoot,
    initialConfig: input.initialConfig,
    configSnapshot: input.configSnapshot,
    logger: input.logger,
    continuityRuntime: input.continuityRuntime,
    runDispatch: input.runDispatch,
    orchestrationEvents: input.orchestrationEvents,
    goalMicroLoopActionPort: input.goalMicroLoopActionPort,
    goalModelProvider,
    goalPlannerModelClient,
    inferenceBudget: input.inferenceBudget,
    goalMicroLoopConfig: input.goalMicroLoopConfig,
    residentIdleConfig: input.residentIdleConfig,
    residentInteractionTarget: input.residentInteractionTarget,
    listResidentSessions: () => input.residentSessionManagerRef.current?.listSessions() ?? [],
    residentWakeAction: input.residentWakeAction,
    deliverResidentMessage: async (request) => {
      if (!input.residentSessionManagerRef.current) throw new Error("Resident idle delivery is not ready.");
      return input.residentSessionManagerRef.current.deliverProactiveMessage(request);
    },
    deliverProactiveResult: async (request) =>
      (await input.channelServiceRef.current?.deliverProactiveResult(request)) ?? "missing",
    identityDisplayValues: input.identityDisplayValues,
  });
  if (composition.activePresetCard && composition.activePresetCard.worldPackageIds.length > 0) {
    input.logger.info("世界包已加载", {
      packages: composition.activePresetCard.worldPackageIds,
      rootDir: input.worldPackagesRoot,
    });
  }
  return composition;
}
