import type { ActionPlanInput, TaskFrame } from "../BamlClient/baml_client/index.js";
import type { AgentCompletionGateDecision } from "../Loop/AgentCompletionGate.js";

export type AgentActionKind =
  | "answer"
  | "ask_user"
  | "discover_tools"
  | "use_tools";

export type AgentActionDecision =
  | {
      action: "answer";
    }
  | {
      action: "ask_user";
      askUser: {
        question: string;
        reason: string | null;
      };
    }
  | {
      action: "discover_tools";
      discoverTools: {
        queries: string[];
        needs: AgentActionCapabilityNeed[];
      };
    }
  | {
      action: "use_tools";
      useTools: {
        preferredTools: string[];
        instruction: string;
        needs: AgentActionCapabilityNeed[];
      };
    };

export interface AgentActionCapabilityNeed {
  actions: string[];
  targets: string[];
  inputs: string[];
  outputs: string[];
  evidence: string[];
  effects: string[];
}

export interface AgentActionPlanResult {
  kind: "planned";
  decision: AgentActionDecision;
  input: ActionPlanInput;
  taskFrame?: TaskFrame;
  evidenceDecision?: AgentCompletionGateDecision;
  selectedAction: AgentActionKind;
  selectionRepaired: boolean;
  payloadRepaired: boolean;
}

export function agentActionPreferredTools(decision: AgentActionDecision | undefined): string[] {
  return decision?.action === "use_tools" ? decision.useTools.preferredTools : [];
}

export function agentActionToolSearchQueries(decision: AgentActionDecision | undefined): string[] {
  return decision?.action === "discover_tools" ? decision.discoverTools.queries : [];
}

export function agentActionCapabilityNeeds(decision: AgentActionDecision | undefined): AgentActionCapabilityNeed[] {
  if (decision?.action === "discover_tools") {
    return decision.discoverTools.needs;
  }
  if (decision?.action === "use_tools") {
    return decision.useTools.needs;
  }
  return [];
}

export function agentActionInstruction(decision: AgentActionDecision | undefined): string {
  if (decision?.action === "use_tools") {
    return decision.useTools.instruction;
  }
  if (decision?.action === "ask_user") {
    return decision.askUser.question;
  }
  return "";
}
