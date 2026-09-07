import type { AssistantMessage, AssistantMessageEventStream, Context } from "@earendil-works/pi-ai";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { AgentModelInputInspection } from "../Text/AgentTurnTokenBudget.js";

export const AgentResidentActionSpeechCapability = "resident-speech.action";
export const AgentResidentFinalSpeechCapability = "resident-speech.final";

export const AgentResidentSpeechCapabilities = [
  AgentResidentActionSpeechCapability,
  AgentResidentFinalSpeechCapability,
] as const;

export type AgentResidentSpeechMode = "action_preface" | "final_response";

export interface AgentResidentSpeechAction {
  readonly callId: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly purpose?: string;
}

export interface AgentResidentSpeechFocus {
  readonly mode: AgentResidentSpeechMode;
  readonly draft: string;
  readonly actions: readonly AgentResidentSpeechAction[];
}

export interface AgentResidentSpeechUtterance {
  readonly mode: AgentResidentSpeechMode;
  readonly content: string;
}

/** Continuation of the owning native request with only scene evidence and the required bridge call changed. */
export interface AgentResidentSpeechNativeContinuation {
  stream(input: {
    readonly context: Context;
    readonly requiredToolName: string;
    readonly signal: AbortSignal;
  }): AssistantMessageEventStream;
}

export interface AgentResidentSpeechProjectionInput {
  readonly context: Context;
  readonly message: AssistantMessage;
  readonly focus: AgentResidentSpeechFocus;
  readonly spokenUtterances: readonly AgentResidentSpeechUtterance[];
  readonly enabled: boolean;
  readonly signal?: AbortSignal;
  readonly sessionId: string;
  readonly nativeContinuation?: AgentResidentSpeechNativeContinuation;
  readonly usageSink?: AgentModelUsageSink;
  readonly timingSink?: AgentModelTimingSink;
  readonly inputBudget?: {
    inspectModelInput(payload: unknown): AgentModelInputInspection;
  };
}

export interface AgentResidentSpeechProjector {
  project(input: AgentResidentSpeechProjectionInput): Promise<AssistantMessage>;
}

export interface AgentResidentSpeechSessionRuntime extends AgentResidentSpeechProjector {
  resetSession(sessionId: string): void;
  close(): void;
}

export interface AgentResidentSpeechResult {
  readonly utterance: string;
}
