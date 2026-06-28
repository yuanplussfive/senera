import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  EvidenceVerification as BamlEvidenceVerification,
  FastContextScoutPlannerDecision as BamlFastContextScoutPlannerDecision,
  InteractionRoute as BamlInteractionRoute,
  TaskFrame as BamlTaskFrame,
  ToolCallPlan as BamlToolCallPlan,
  TurnUnderstanding as BamlTurnUnderstanding,
} from "../BamlClient/baml_client/types.js";
import type { AgentFastContextScoutPlannerPromptInput } from "./AgentFastContextScoutPlannerPromptJson.js";
import type { AgentToolCallPlannerPromptInput } from "./AgentToolCallPlannerPromptJson.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";

export class AgentActionPlannerCoreModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async buildTaskFrame(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTaskFrame> {
    return this.caller.run({
      functionName: "BuildTaskFrame",
      args: {
        functionName: "BuildTaskFrame",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.BuildTaskFrame(rawOutput),
      repair: (failure) => ({
        functionName: "RepairTaskFrame",
        input,
        invalidTaskFrame: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async understandUserTurn(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTurnUnderstanding> {
    return this.caller.run({
      functionName: "UnderstandUserTurn",
      args: {
        functionName: "UnderstandUserTurn",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.UnderstandUserTurn(rawOutput),
      repair: (failure) => ({
        functionName: "RepairTurnUnderstanding",
        input,
        invalidUnderstanding: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async routeInteraction(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlInteractionRoute> {
    return this.caller.run({
      functionName: "RouteInteraction",
      args: {
        functionName: "RouteInteraction",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.RouteInteraction(rawOutput),
      repair: (failure) => ({
        functionName: "RepairInteractionRoute",
        input,
        invalidRoute: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async verifyTaskEvidence(options: {
    input: ActionPlanInput;
    taskFrame: BamlTaskFrame;
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlEvidenceVerification> {
    return this.caller.run({
      functionName: "VerifyTaskEvidence",
      args: {
        functionName: "VerifyTaskEvidence",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.VerifyTaskEvidence(rawOutput),
      repair: (failure) => ({
        functionName: "RepairEvidenceVerification",
        ...options,
        invalidVerification: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairTaskFrame(options: {
    input: ActionPlanInput;
    invalidTaskFrame: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTaskFrame> {
    return this.caller.repair({
      functionName: "RepairTaskFrame",
      args: {
        functionName: "RepairTaskFrame",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairTaskFrame(rawOutput),
    });
  }

  async repairTurnUnderstanding(options: {
    input: ActionPlanInput;
    invalidUnderstanding: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTurnUnderstanding> {
    return this.caller.repair({
      functionName: "RepairTurnUnderstanding",
      args: {
        functionName: "RepairTurnUnderstanding",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairTurnUnderstanding(rawOutput),
    });
  }

  async planFastContextScout(
    input: AgentFastContextScoutPlannerPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlFastContextScoutPlannerDecision> {
    return this.caller.run({
      functionName: "PlanFastContextScout",
      args: {
        functionName: "PlanFastContextScout",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.PlanFastContextScout(rawOutput),
      repair: (failure) => ({
        functionName: "RepairFastContextScoutPlan",
        input,
        invalidDecision: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairFastContextScoutPlan(options: {
    input: AgentFastContextScoutPlannerPromptInput;
    invalidDecision: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlFastContextScoutPlannerDecision> {
    return this.caller.repair({
      functionName: "RepairFastContextScoutPlan",
      args: {
        functionName: "RepairFastContextScoutPlan",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairFastContextScoutPlan(rawOutput),
    });
  }

  async planToolCalls(
    input: AgentToolCallPlannerPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolCallPlan> {
    return this.caller.run({
      functionName: "PlanToolCalls",
      args: {
        functionName: "PlanToolCalls",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.PlanToolCalls(rawOutput),
      repair: (failure) => ({
        functionName: "RepairToolCallPlan",
        input,
        invalidPlan: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairToolCallPlan(options: {
    input: AgentToolCallPlannerPromptInput;
    invalidPlan: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlToolCallPlan> {
    return this.caller.repair({
      functionName: "RepairToolCallPlan",
      args: {
        functionName: "RepairToolCallPlan",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolCallPlan(rawOutput),
    });
  }
}
