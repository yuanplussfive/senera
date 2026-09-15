import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentContinuitySnapshot } from "../Continuity/AgentContinuitySnapshot.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">>;

export type AgentPromptDomainEvent =
  | {
      kind: typeof AgentEventKinds.PromptSummary;
      context: AgentStepContext;
      data: {
        chars: number;
        lines: number;
        tokenCount: number;
      };
    }
  | {
      kind: typeof AgentEventKinds.ContinuitySnapshot;
      context: AgentStepContext;
      data: AgentContinuitySnapshot;
    }
  | {
      kind: typeof AgentEventKinds.PromptHarnessComposed;
      context: AgentStepContext;
      data: {
        profile: "native" | "baml";
        sections: {
          frozen: { bytes: number; tokens: number; revision: string };
          stable: { bytes: number; tokens: number; revision: string };
          volatile: { bytes: number; tokens: number; revision: string };
        };
        merged: { bytes: number; tokens: number };
      };
    };
