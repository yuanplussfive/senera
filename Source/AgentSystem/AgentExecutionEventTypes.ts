import { AgentEventKinds } from "./AgentEventCatalog.js";
import type { AgentEventContext } from "./AgentEventBase.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentActionPlannerStageName } from "./AgentActionPlannerTelemetry.js";
import type { AgentInteractionRunMode } from "./AgentInteractionRouter.js";

export type AgentExecutionDomainEvent =
  | {
      kind: typeof AgentEventKinds.RunStarted;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        input: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PromptRendered;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        prompt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PromptSummary;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        chars: number;
        lines: number;
        tokenCount: number;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
        selectedAction?: string;
        repaired?: boolean;
        turnUnderstanding?: {
          rawUserTurn: string;
          standaloneRequest: string;
          contextMode: "None" | "Used" | "Insufficient";
          contextBasis: string;
          missingContext: string;
        };
        taskFrame?: {
          taskType: string;
          answerGoal: string;
          intentTags: string[];
          targetRefs: Array<{
            kind: string;
            value: string;
            status: string;
          }>;
          candidateTools: Array<{
            name: string;
            purpose: string;
            supports: string[];
          }>;
          discoveryQueries: string[];
          requiredEffects: Array<{
            id: string;
            effect: string;
            target: string;
            proof: string;
            reason: string;
          }>;
          requiredEvidence: Array<{
            id: string;
            need: string;
            scope: string;
            minimum: number;
            reason: string;
          }>;
          userInputNeeds: Array<{
            question: string;
            reason: string;
          }>;
          nextStepPurpose: string;
          completionCriteria: string[];
          notes: string[];
        };
        evidenceDecision?: {
          ready: boolean;
          missingNeeds: Array<{
            id: string;
            need: string;
            reason: string;
            status: "partial" | "missing" | "stalled" | "blocked";
            observed: number;
            required: number;
            missingFacts: string[];
            unsupportedClaims: string[];
            blockers: string[];
          }>;
          satisfiedNeeds: Array<{
            id: string;
            need: string;
            evidence: Array<{
              evidenceUri: string;
              kind: string;
              toolName: string;
              artifactUri: string;
              locator: string;
              display: string;
              label: string;
              source?: string | null;
              confidence?: number | null;
              facts: Array<{
                name: string;
                value: string;
              }>;
              produces: string;
              satisfies: string[];
              quality: string;
              supportingSignals: string[];
            }>;
          }>;
          requirementStates: Array<{
            id: string;
            need: string;
            status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
            reason: string;
            observed: number;
            required: number;
            evidence: Array<{
              evidenceUri: string;
              kind: string;
              toolName: string;
              artifactUri: string;
              locator: string;
              display: string;
              label: string;
              source?: string | null;
              confidence?: number | null;
              facts: Array<{
                name: string;
                value: string;
              }>;
              produces: string;
              satisfies: string[];
              quality: string;
              supportingSignals: string[];
            }>;
            missingFacts: string[];
            unsupportedClaims: string[];
            blockers: string[];
          }>;
          progress: {
            stalled: boolean;
            repeatedCalls: Array<{
              toolName: string;
              argsHash: string;
              count: number;
              lastStep: number;
            }>;
            nonEvidenceCalls: Array<{
              step: number;
              toolName: string;
              status: string;
              resultKind: string;
              artifactUri: string;
              evidenceUris: string[];
              argumentsPreview: string;
              error: string;
            }>;
            failedCalls: Array<{
              step: number;
              toolName: string;
              status: string;
              resultKind: string;
              artifactUri: string;
              evidenceUris: string[];
              argumentsPreview: string;
              error: string;
            }>;
          };
          verification?: {
            ready: boolean;
            requirements: Array<{
              requirementId: string;
              need: string;
              status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
              evidenceUris: string[];
              artifactUris: string[];
              reason: string;
              missingFacts: string[];
              unsupportedClaims: string[];
            }>;
            summary: string;
          };
          recommendedTools: string[];
          searchQueries: string[];
        };
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageFailed;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.InteractionRouted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
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
        loadedTools: string[] | "all";
        expectedOutputMode?: "tool_call_xml" | "final_text" | "open";
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlanned;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        status: "planned";
        action: string;
        expectedOutputMode?: "tool_call_xml" | "final_text" | "open";
        instruction?: string;
        askUserQuestion?: string;
        capabilityNeeds?: Array<{
          actions: string[];
          targets: string[];
          inputs: string[];
          outputs: string[];
          evidence: string[];
          effects: string[];
        }>;
        preferredTools: string[];
        toolSearchQueries: string[];
        loadedTools: string[] | "all";
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
        taskFrame?: {
          taskType: string;
          answerGoal: string;
          intentTags: string[];
          targetRefs: Array<{
            kind: string;
            value: string;
            status: string;
          }>;
          candidateTools: Array<{
            name: string;
            purpose: string;
            supports: string[];
          }>;
          discoveryQueries: string[];
          requiredEffects: Array<{
            id: string;
            effect: string;
            target: string;
            proof: string;
            reason: string;
          }>;
          requiredEvidence: Array<{
            id: string;
            need: string;
            scope: string;
            minimum: number;
            reason: string;
          }>;
          userInputNeeds: Array<{
            question: string;
            reason: string;
          }>;
          nextStepPurpose: string;
          completionCriteria: string[];
          notes: string[];
        };
        evidenceDecision?: {
          ready: boolean;
          missingNeeds: Array<{
            id: string;
            need: string;
            reason: string;
            status: "partial" | "missing" | "stalled" | "blocked";
            observed: number;
            required: number;
            missingFacts: string[];
            unsupportedClaims: string[];
            blockers: string[];
          }>;
          satisfiedNeeds: Array<{
            id: string;
            need: string;
            evidence: Array<{
              evidenceUri: string;
              kind: string;
              toolName: string;
              artifactUri: string;
              locator: string;
              display: string;
              label: string;
              source?: string | null;
              confidence?: number | null;
              facts: Array<{
                name: string;
                value: string;
              }>;
              produces: string;
              satisfies: string[];
              quality: string;
              supportingSignals: string[];
            }>;
          }>;
          requirementStates: Array<{
            id: string;
            need: string;
            status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
            reason: string;
            observed: number;
            required: number;
            evidence: Array<{
              evidenceUri: string;
              kind: string;
              toolName: string;
              artifactUri: string;
              locator: string;
              display: string;
              label: string;
              source?: string | null;
              confidence?: number | null;
              facts: Array<{
                name: string;
                value: string;
              }>;
              produces: string;
              satisfies: string[];
              quality: string;
              supportingSignals: string[];
            }>;
            missingFacts: string[];
            unsupportedClaims: string[];
            blockers: string[];
          }>;
          progress: {
            stalled: boolean;
            repeatedCalls: Array<{
              toolName: string;
              argsHash: string;
              count: number;
              lastStep: number;
            }>;
            nonEvidenceCalls: Array<{
              step: number;
              toolName: string;
              status: string;
              resultKind: string;
              artifactUri: string;
              evidenceUris: string[];
              argumentsPreview: string;
              error: string;
            }>;
            failedCalls: Array<{
              step: number;
              toolName: string;
              status: string;
              resultKind: string;
              artifactUri: string;
              evidenceUris: string[];
              argumentsPreview: string;
              error: string;
            }>;
          };
          verification?: {
            ready: boolean;
            requirements: Array<{
              requirementId: string;
              need: string;
              status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
              evidenceUris: string[];
              artifactUris: string[];
              reason: string;
              missingFacts: string[];
              unsupportedClaims: string[];
            }>;
            summary: string;
          };
          recommendedTools: string[];
          searchQueries: string[];
        };
        activeSkills?: Array<{
          name: string;
          title: string;
          score: number;
          matchedTerms: string[];
          matchedFields: Array<{
            term: string;
            fields: string[];
          }>;
          recommendedTools: string[];
          recommendedAgents: string[];
          recommendedWorkflows: string[];
        }>;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        model: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamOpened;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelDelta;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        text: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        text: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamAborted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        reason: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.FinalAnswer;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        content: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.AskUser;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        question: string;
        reasonCode?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCompleted;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: Record<string, never>;
    }
  | {
      kind: typeof AgentEventKinds.RunFailed;
      context: Required<Pick<AgentEventContext, "requestId">> &
        Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        message: string;
        code?: string;
        details?: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCancelled;
      context: Required<Pick<AgentEventContext, "requestId">> &
        Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        reason: "user_cancelled";
      };
    }
  | {
      kind: typeof AgentEventKinds.RequestInvalid;
      context: AgentEventContext;
      data: {
        message: string;
        details?: unknown;
      };
    };
