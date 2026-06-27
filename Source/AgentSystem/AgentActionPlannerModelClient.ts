import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "./BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  EvidenceVerification as BamlEvidenceVerification,
  FastContextScoutPlannerDecision as BamlFastContextScoutPlannerDecision,
  InteractionRoute as BamlInteractionRoute,
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
  TaskFrame as BamlTaskFrame,
  ToolLearningResult as BamlToolLearningResult,
  ToolCallPlan as BamlToolCallPlan,
  TurnUnderstanding as BamlTurnUnderstanding,
} from "./BamlClient/baml_client/types.js";
import { createModelProviderMetadata } from "./AgentModelMetadata.js";
import { createModelEndpoint } from "./ModelEndpoints/ModelEndpointTypes.js";
import type { TextGenerationEndpoint } from "./ModelEndpoints/ModelEndpointTypes.js";
import { ModelHttpClient } from "./ModelEndpoints/ModelHttpClient.js";
import type {
  AgentActionPlannerClientConfig,
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "./Types/AgentConfigTypes.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import {
  buildActionPlannerPromptJson,
  buildEvidenceVerificationPromptJson,
} from "./AgentActionPlannerPromptJson.js";
import {
  buildFastContextScoutPromptJson,
  type AgentFastContextScoutPlannerPromptInput,
} from "./AgentFastContextScoutPlannerPromptJson.js";
import {
  buildToolCallPlannerPromptJson,
  type AgentToolCallPlannerPromptInput,
} from "./AgentToolCallPlannerPromptJson.js";
import {
  projectActionPlannerBamlRequestBody,
} from "./AgentActionPlannerPromptProjector.js";
import { throwIfAborted } from "./AgentCancellation.js";
import {
  AgentBamlStructuredOutputRunner,
  type AgentBamlModelRequest,
  type AgentBamlStructuredOutputTraceSink,
} from "./AgentBamlStructuredOutputRunner.js";
import {
  issueMessages,
} from "./AgentActionPlannerFailure.js";

type PlannerBamlFunctionArgs =
  | {
      functionName: "UnderstandUserTurn";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairTurnUnderstanding";
      input: ActionPlanInput;
      invalidUnderstanding: string;
      issues: string[];
    }
  | {
      functionName: "RouteInteraction";
      input: ActionPlanInput;
    }
  | {
      functionName: "BuildTaskFrame";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairTaskFrame";
      input: ActionPlanInput;
      invalidTaskFrame: string;
      issues: string[];
    }
  | {
      functionName: "RepairInteractionRoute";
      input: ActionPlanInput;
      invalidRoute: string;
      issues: string[];
    }
  | {
      functionName: "VerifyTaskEvidence";
      input: ActionPlanInput;
      taskFrame: BamlTaskFrame;
    }
  | {
      functionName: "RepairEvidenceVerification";
      input: ActionPlanInput;
      taskFrame: BamlTaskFrame;
      invalidVerification: string;
      issues: string[];
    }
  | {
      functionName: "PlanFastContextScout";
      input: AgentFastContextScoutPlannerPromptInput;
    }
  | {
      functionName: "RepairFastContextScoutPlan";
      input: AgentFastContextScoutPlannerPromptInput;
      invalidDecision: string;
      issues: string[];
    }
  | {
      functionName: "PlanToolCalls";
      input: AgentToolCallPlannerPromptInput;
    }
  | {
      functionName: "RepairToolCallPlan";
      input: AgentToolCallPlannerPromptInput;
      invalidPlan: string;
      issues: string[];
    }
  | {
      functionName: "LearnToolUse";
      input: AgentToolLearningPromptInput;
    }
  | {
      functionName: "RepairToolLearning";
      input: AgentToolLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    }
  | {
      functionName: "LearnMemory";
      input: AgentMemoryLearningPromptInput;
    }
  | {
      functionName: "RepairMemoryLearning";
      input: AgentMemoryLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    }
  | {
      functionName: "ConsolidateMemoryCandidates";
      input: AgentMemoryConsolidationPromptInput;
    }
  | {
      functionName: "RepairMemoryConsolidation";
      input: AgentMemoryConsolidationPromptInput;
      invalidConsolidation: string;
      issues: string[];
    }
  | {
      functionName: "ResolveMemoryWrite";
      input: AgentMemoryWriteResolutionPromptInput;
    }
  | {
      functionName: "RepairMemoryWriteResolution";
      input: AgentMemoryWriteResolutionPromptInput;
      invalidResolution: string;
      issues: string[];
    };

export interface AgentToolLearningPromptInput {
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  selectedTools: string[];
  candidateSourceTerms: string[];
  toolTagCatalogByTool: Array<{
    toolName: string;
    tags: string[];
  }>;
  search: {
    query: string;
    plannerTags: string[];
    candidates: string[];
  };
  episode: {
    outcome: string;
    producedEvidence: boolean;
    producedArtifact: boolean;
    changedWorkspace: boolean;
  };
}

export interface AgentMemoryLearningPromptInput {
  memoryTypes: string[];
  episode: {
    episodeUri: string;
    requestId: string;
    standaloneRequest: string;
    contextMode: string;
    contextBasis: string;
    startedAt: string;
    completedAt: string;
    localDate: string;
    localHour: string;
  };
  timeline: Array<{
    index: number;
    role: "user" | "assistant";
    kind: string;
    content: string;
    payloadJson: string;
    evidenceUris: string[];
    artifactUris: string[];
  }>;
  sourceCatalog: Array<{
    sourceRef: string;
    sourceKind: string;
    role: string;
    memoryRole: "support" | "context";
    evidenceUri: string;
    artifactUri: string;
    toolName: string;
    createdAt: string;
  }>;
  supportingSourceRefs: string[];
  contextSourceRefs: string[];
}

export interface AgentMemoryConsolidationPromptInput {
  memoryTypes: string[];
  episode: AgentMemoryLearningPromptInput["episode"];
  candidates: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    sourceRefs: string[];
    reason: string;
    confidence: number;
    createdAt: string;
  }>;
  existingMemories: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    confidence: number;
    updatedAt: string;
  }>;
}

export interface AgentMemoryWriteResolutionPromptInput {
  memoryTypes: string[];
  allowedOperations: string[];
  request: {
    source: "automatic_learning" | "direct_tool";
    requestId: string;
    standaloneRequest: string;
  };
  proposed: {
    operation: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    sourceRefs: string[];
    candidateUris: string[];
    targetMemoryUri?: string;
    reason: string;
    confidence: number;
  };
  similarMemories: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    confidence: number;
    updatedAt: string;
    similarity: number;
  }>;
}

export class AgentActionPlannerModelClient {
  readonly providerConfig: ResolvedAgentModelProviderConfig;
  private readonly provider: ResolvedAgentModelProviderConfig;
  private readonly endpoint: TextGenerationEndpoint;
  private readonly promptRegistry = createPromptRegistry();
  private readonly structuredOutputRunner: AgentBamlStructuredOutputRunner;

  constructor(
    model: ResolvedAgentModelProviderConfig,
    overrides: ResolvedAgentActionPlannerClientConfig,
    options: {
      maxRepairAttempts?: number;
      traceSink?: AgentBamlStructuredOutputTraceSink;
    } = {},
  ) {
    this.provider = resolvePlannerProvider(model, overrides);
    this.providerConfig = this.provider;
    this.endpoint = createModelEndpoint(this.provider.Endpoint, {
      config: this.provider,
      http: new ModelHttpClient(
        this.provider,
        createModelProviderMetadata(this.provider),
      ),
    });
    this.structuredOutputRunner = new AgentBamlStructuredOutputRunner({
      complete: (request, signal) => this.complete(request, signal),
      maxRepairAttempts: options.maxRepairAttempts ?? 0,
      traceSink: options.traceSink,
      describeIssues: issueMessages,
    });
  }

  async buildTaskFrame(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTaskFrame> {
    const result = await this.structuredOutputRunner.run({
      functionName: "BuildTaskFrame",
      request: await this.buildPrompt({
        functionName: "BuildTaskFrame",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.BuildTaskFrame(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairTaskFrame",
        input,
        invalidTaskFrame: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async understandUserTurn(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlTurnUnderstanding> {
    const result = await this.structuredOutputRunner.run({
      functionName: "UnderstandUserTurn",
      request: await this.buildPrompt({
        functionName: "UnderstandUserTurn",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.UnderstandUserTurn(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairTurnUnderstanding",
        input,
        invalidUnderstanding: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async routeInteraction(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlInteractionRoute> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RouteInteraction",
      request: await this.buildPrompt({
        functionName: "RouteInteraction",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.RouteInteraction(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairInteractionRoute",
        input,
        invalidRoute: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async verifyTaskEvidence(options: {
    input: ActionPlanInput;
    taskFrame: BamlTaskFrame;
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlEvidenceVerification> {
    const result = await this.structuredOutputRunner.run({
      functionName: "VerifyTaskEvidence",
      request: await this.buildPrompt({
        functionName: "VerifyTaskEvidence",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.VerifyTaskEvidence(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairEvidenceVerification",
        ...options,
        invalidVerification: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairTaskFrame(options: {
    input: ActionPlanInput;
    invalidTaskFrame: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTaskFrame> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairTaskFrame",
      request: await this.buildPrompt({
        functionName: "RepairTaskFrame",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairTaskFrame(rawOutput),
    });
    return result.value;
  }

  async repairTurnUnderstanding(options: {
    input: ActionPlanInput;
    invalidUnderstanding: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlTurnUnderstanding> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairTurnUnderstanding",
      request: await this.buildPrompt({
        functionName: "RepairTurnUnderstanding",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairTurnUnderstanding(rawOutput),
    });
    return result.value;
  }

  async planFastContextScout(
    input: AgentFastContextScoutPlannerPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlFastContextScoutPlannerDecision> {
    const result = await this.structuredOutputRunner.run({
      functionName: "PlanFastContextScout",
      request: await this.buildPrompt({
        functionName: "PlanFastContextScout",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.PlanFastContextScout(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairFastContextScoutPlan",
        input,
        invalidDecision: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairFastContextScoutPlan(options: {
    input: AgentFastContextScoutPlannerPromptInput;
    invalidDecision: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlFastContextScoutPlannerDecision> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairFastContextScoutPlan",
      request: await this.buildPrompt({
        functionName: "RepairFastContextScoutPlan",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairFastContextScoutPlan(rawOutput),
    });
    return result.value;
  }

  async planToolCalls(
    input: AgentToolCallPlannerPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolCallPlan> {
    const result = await this.structuredOutputRunner.run({
      functionName: "PlanToolCalls",
      request: await this.buildPrompt({
        functionName: "PlanToolCalls",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.PlanToolCalls(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairToolCallPlan",
        input,
        invalidPlan: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairToolCallPlan(options: {
    input: AgentToolCallPlannerPromptInput;
    invalidPlan: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlToolCallPlan> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairToolCallPlan",
      request: await this.buildPrompt({
        functionName: "RepairToolCallPlan",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolCallPlan(rawOutput),
    });
    return result.value;
  }

  async learnToolUse(
    input: AgentToolLearningPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolLearningResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "LearnToolUse",
      request: await this.buildPrompt({
        functionName: "LearnToolUse",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.LearnToolUse(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairToolLearning",
        input,
        invalidLearning: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairToolLearning(options: {
    input: AgentToolLearningPromptInput;
    invalidLearning: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlToolLearningResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairToolLearning",
      request: await this.buildPrompt({
        functionName: "RepairToolLearning",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolLearning(rawOutput),
    });
    return result.value;
  }

  async learnMemory(
    input: AgentMemoryLearningPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryLearningResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "LearnMemory",
      request: await this.buildPrompt({
        functionName: "LearnMemory",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.LearnMemory(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairMemoryLearning",
        input,
        invalidLearning: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairMemoryLearning(options: {
    input: AgentMemoryLearningPromptInput;
    invalidLearning: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlMemoryLearningResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairMemoryLearning",
      request: await this.buildPrompt({
        functionName: "RepairMemoryLearning",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryLearning(rawOutput),
    });
    return result.value;
  }

  async consolidateMemoryCandidates(
    input: AgentMemoryConsolidationPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryConsolidationResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "ConsolidateMemoryCandidates",
      request: await this.buildPrompt({
        functionName: "ConsolidateMemoryCandidates",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.ConsolidateMemoryCandidates(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairMemoryConsolidation",
        input,
        invalidConsolidation: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairMemoryConsolidation(options: {
    input: AgentMemoryConsolidationPromptInput;
    invalidConsolidation: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlMemoryConsolidationResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairMemoryConsolidation",
      request: await this.buildPrompt({
        functionName: "RepairMemoryConsolidation",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryConsolidation(rawOutput),
    });
    return result.value;
  }

  async resolveMemoryWrite(
    input: AgentMemoryWriteResolutionPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryWriteResolutionResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "ResolveMemoryWrite",
      request: await this.buildPrompt({
        functionName: "ResolveMemoryWrite",
        input,
      }),
      signal: options.signal,
      parse: (rawOutput) => baml.parse.ResolveMemoryWrite(rawOutput),
      repair: (failure) => this.buildPrompt({
        functionName: "RepairMemoryWriteResolution",
        input,
        invalidResolution: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
    return result.value;
  }

  async repairMemoryWriteResolution(options: {
    input: AgentMemoryWriteResolutionPromptInput;
    invalidResolution: string;
    issues: string[];
  }, requestOptions: { signal?: AbortSignal } = {}): Promise<BamlMemoryWriteResolutionResult> {
    const result = await this.structuredOutputRunner.run({
      functionName: "RepairMemoryWriteResolution",
      request: await this.buildPrompt({
        functionName: "RepairMemoryWriteResolution",
        ...options,
      }),
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryWriteResolution(rawOutput),
    });
    return result.value;
  }

  private async complete(request: AgentBamlModelRequest, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const stream = await this.endpoint.stream({
      ...request,
      signal,
    });
    let text = "";
    const abort = (): void => stream.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        throwIfAborted(signal);
        text = chunk.accumulatedText;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    throwIfAborted(signal);
    return text;
  }

  private async buildPrompt(args: PlannerBamlFunctionArgs): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectActionPlannerBamlRequestBody(request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
    };
  }

  private buildBamlRequest(args: PlannerBamlFunctionArgs) {
    const options = {
      clientRegistry: this.promptRegistry,
    };

    switch (args.functionName) {
      case "UnderstandUserTurn":
        return baml.request.UnderstandUserTurn(
          buildActionPlannerPromptJson(args.input, {
            stage: "understandUserTurn",
          }),
          options,
        );
      case "RepairTurnUnderstanding":
        return baml.request.RepairTurnUnderstanding(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairTurnUnderstanding",
            invalidUnderstanding: args.invalidUnderstanding,
            issues: args.issues,
          }),
          options,
        );
      case "RouteInteraction":
        return baml.request.RouteInteraction(
          buildActionPlannerPromptJson(args.input, {
            stage: "routeInteraction",
          }),
          options,
        );
      case "BuildTaskFrame":
        return baml.request.BuildTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "buildTaskFrame",
          }),
          options,
        );
      case "RepairTaskFrame":
        return baml.request.RepairTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairTaskFrame",
            invalidTaskFrame: args.invalidTaskFrame,
            issues: args.issues,
          }),
          options,
        );
      case "RepairInteractionRoute":
        return baml.request.RepairInteractionRoute(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairInteractionRoute",
            invalidRoute: args.invalidRoute,
            issues: args.issues,
          }),
          options,
        );
      case "VerifyTaskEvidence":
        return baml.request.VerifyTaskEvidence(
          buildEvidenceVerificationPromptJson(args.input, args.taskFrame),
          options,
        );
      case "RepairEvidenceVerification":
        return baml.request.RepairEvidenceVerification(
          buildEvidenceVerificationPromptJson(args.input, args.taskFrame, {
            stage: "repairEvidenceVerification",
            invalidVerification: args.invalidVerification,
            issues: args.issues,
          }),
          options,
        );
      case "PlanFastContextScout":
        return baml.request.PlanFastContextScout(
          buildFastContextScoutPromptJson(args.input, {
            stage: "planFastContextScout",
          }),
          options,
        );
      case "RepairFastContextScoutPlan":
        return baml.request.RepairFastContextScoutPlan(
          buildFastContextScoutPromptJson(args.input, {
            stage: "repairFastContextScoutPlan",
            invalidDecision: args.invalidDecision,
            issues: args.issues,
          }),
          options,
        );
      case "PlanToolCalls":
        return baml.request.PlanToolCalls(
          buildToolCallPlannerPromptJson(args.input, {
            stage: "planToolCalls",
          }),
          options,
        );
      case "RepairToolCallPlan":
        return baml.request.RepairToolCallPlan(
          buildToolCallPlannerPromptJson(args.input, {
            stage: "repairToolCallPlan",
            invalidPlan: args.invalidPlan,
            issues: args.issues,
          }),
          options,
        );
      case "LearnToolUse":
        return baml.request.LearnToolUse(
          buildToolLearningPromptJson(args.input, {
            stage: "learnToolUse",
          }),
          options,
        );
      case "RepairToolLearning":
        return baml.request.RepairToolLearning(
          buildToolLearningPromptJson(args.input, {
            stage: "repairToolLearning",
            invalidLearning: args.invalidLearning,
            issues: args.issues,
          }),
          options,
        );
      case "LearnMemory":
        return baml.request.LearnMemory(
          buildMemoryLearningPromptJson(args.input, {
            stage: "learnMemory",
          }),
          options,
        );
      case "RepairMemoryLearning":
        return baml.request.RepairMemoryLearning(
          buildMemoryLearningPromptJson(args.input, {
            stage: "repairMemoryLearning",
            invalidLearning: args.invalidLearning,
            issues: args.issues,
          }),
          options,
        );
      case "ConsolidateMemoryCandidates":
        return baml.request.ConsolidateMemoryCandidates(
          buildMemoryConsolidationPromptJson(args.input, {
            stage: "consolidateMemoryCandidates",
          }),
          options,
        );
      case "RepairMemoryConsolidation":
        return baml.request.RepairMemoryConsolidation(
          buildMemoryConsolidationPromptJson(args.input, {
            stage: "repairMemoryConsolidation",
            invalidConsolidation: args.invalidConsolidation,
            issues: args.issues,
          }),
          options,
        );
      case "ResolveMemoryWrite":
        return baml.request.ResolveMemoryWrite(
          buildMemoryWriteResolutionPromptJson(args.input, {
            stage: "resolveMemoryWrite",
          }),
          options,
        );
      case "RepairMemoryWriteResolution":
        return baml.request.RepairMemoryWriteResolution(
          buildMemoryWriteResolutionPromptJson(args.input, {
            stage: "repairMemoryWriteResolution",
            invalidResolution: args.invalidResolution,
            issues: args.issues,
          }),
          options,
        );
    }
  }
}

type AgentToolLearningPromptStage =
  | {
      stage: "learnToolUse";
    }
  | {
      stage: "repairToolLearning";
      invalidLearning: string;
      issues: string[];
    };

function buildToolLearningPromptJson(
  input: AgentToolLearningPromptInput,
  directive: AgentToolLearningPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

type AgentMemoryLearningPromptStage =
  | {
      stage: "learnMemory";
    }
  | {
      stage: "repairMemoryLearning";
      invalidLearning: string;
      issues: string[];
    };

export function buildMemoryLearningPromptJson(
  input: AgentMemoryLearningPromptInput,
  directive: AgentMemoryLearningPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

type AgentMemoryConsolidationPromptStage =
  | {
      stage: "consolidateMemoryCandidates";
    }
  | {
      stage: "repairMemoryConsolidation";
      invalidConsolidation: string;
      issues: string[];
    };

function buildMemoryConsolidationPromptJson(
  input: AgentMemoryConsolidationPromptInput,
  directive: AgentMemoryConsolidationPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

type AgentMemoryWriteResolutionPromptStage =
  | {
      stage: "resolveMemoryWrite";
    }
  | {
      stage: "repairMemoryWriteResolution";
      invalidResolution: string;
      issues: string[];
    };

function buildMemoryWriteResolutionPromptJson(
  input: AgentMemoryWriteResolutionPromptInput,
  directive: AgentMemoryWriteResolutionPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

function createPromptRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
    model: "prompt-builder",
    temperature: 0,
  });
  registry.setPrimary("SeneraActionPlannerPromptBuilder");
  return registry;
}

function resolvePlannerProvider(
  model: ResolvedAgentModelProviderConfig,
  overrides: ResolvedAgentActionPlannerClientConfig,
): ResolvedAgentModelProviderConfig {
  return {
    ...model,
    Endpoint: resolvePlannerEndpoint(overrides.Provider),
    BaseUrl: overrides.BaseUrl,
    ApiKey: overrides.ApiKey,
    Model: overrides.Model,
    Temperature: overrides.Temperature ?? 0.1,
    MaxOutputTokens: overrides.MaxTokens ?? -1,
    Stream: false,
  };
}

function resolvePlannerEndpoint(
  provider: ResolvedAgentActionPlannerClientConfig["Provider"],
): ResolvedAgentModelProviderConfig["Endpoint"] {
  return ProviderEndpointMap[provider];
}

const ProviderEndpointMap = {
  "openai-generic": "ChatCompletions",
  "openai-responses": "Responses",
  anthropic: "ClaudeMessages",
  "google-ai": "GoogleGenerateContent",
} as const satisfies Record<
  ResolvedAgentActionPlannerClientConfig["Provider"],
  ResolvedAgentModelProviderConfig["Endpoint"]
>;
