import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentActionPlannerStageName } from "../ActionPlanner/AgentActionPlannerTelemetry.js";
import type { AgentActionCapabilityNeed } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentInteractionRunMode } from "../ActionPlanner/AgentInteractionRouter.js";
import type {
  AgentActivatedSkillEventData,
  AgentTurnUnderstandingEventData,
} from "./AgentExecutionEventSharedTypes.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">>;
type AgentLoadedToolNames = "all" | string[];
type AgentExpectedOutputMode = "final_text" | "open";

export type AgentPlannerDomainEvent =
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageStarted;
      context: AgentStepContext;
      data: {
        stage: AgentActionPlannerStageName;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageCompleted;
      context: AgentStepContext;
      data: {
        stage: AgentActionPlannerStageName;
        selectedAction?: string;
        repaired?: boolean;
        turnUnderstanding?: AgentTurnUnderstandingEventData;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageFailed;
      context: AgentStepContext;
      data: {
        stage: AgentActionPlannerStageName;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.InteractionRouted;
      context: AgentStepContext;
      data: {
        mode: AgentInteractionRunMode;
        objective: string;
        needsFreshEvidence: boolean;
        needsWorkspaceRead: boolean;
        needsSideEffect: boolean;
        risk: string;
        preferredTools: string[];
        discoveryQueries: string[];
        reason: string;
        loadedTools: AgentLoadedToolNames;
        expectedOutputMode?: AgentExpectedOutputMode;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlanned;
      context: AgentStepContext;
      data: {
        status: "planned";
        action: string;
        expectedOutputMode?: AgentExpectedOutputMode;
        instruction?: string;
        askUserQuestion?: string;
        capabilityNeeds?: AgentActionCapabilityNeed[];
        preferredTools: string[];
        toolSearchQueries: string[];
        loadedTools: AgentLoadedToolNames;
        currentStep?: number;
        runState?: {
          totalToolCalls: number;
          totalEvidence: number;
          repeatedCallCount: number;
          stalled: boolean;
          timelineTurnCount: number;
        };
        selectedAction?: string;
        selectionRepaired?: boolean;
        payloadRepaired?: boolean;
        activeSkills?: AgentActivatedSkillEventData[];
      };
    };
