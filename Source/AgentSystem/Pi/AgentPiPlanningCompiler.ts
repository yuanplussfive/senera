import type { Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentLanguageModelImageAttachment,
  AgentLanguageModelInvocationOptions,
} from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import { AgentStructuredOutputValidationError } from "../Diagnostics/AgentStructuredOutputValidationError.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { parsePiToolArgumentsDraft, type ParsedPiToolArgumentsDraft } from "./AgentPiAssistantMessageSchema.js";
import { parseControllerDecision, type ParsedControllerDecision } from "../Interaction/AgentControllerDecision.js";
import type {
  AgentPiAssistantCompilation,
  AgentPiAssistantMessage,
  AgentPiAssistantMessageCompileInput,
  AgentPiControllerDecisionInput,
  AgentPiPlannedToolCall,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
  AgentPiToolContract,
} from "../PiShared/AgentPiPlanningTypes.js";
import { AgentPiPlanningContextCompiler } from "./AgentPiPlanningContextCompiler.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  formatAgentToolContractValidationIssue,
  validateToolContractValue,
} from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import type { AgentPiReadyToolPlanNode, AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { orderToolNamesByPreference, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { validateAgentPiCompletion } from "./AgentPiCompletionGate.js";
import { AgentPiContextPolicyProtocol } from "../PiShared/AgentPiContextPolicyProtocol.js";
import type { AgentPiTurnStateOptions } from "./AgentPiTurnState.js";
import type { AgentPiModelApi } from "./AgentPiTypes.js";
import type { AgentPiCompactionPromptInput } from "../PiShared/AgentPiCompactionPrompt.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { createAgentPiPromptCacheOptions, projectAgentPiPromptCacheModel } from "./AgentPiPromptCache.js";

const EmptyObjectParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

export interface AgentPiPlanningCompilerOptions {
  modelProvider: ResolvedAgentModelProviderConfig;
  client: AgentPiPlanningModelClient;
}

export interface AgentPiPlanningCompileRequest {
  model: Model<AgentPiModelApi>;
  context: Context;
  options?: SimpleStreamOptions;
  toolAccessGrant: AgentToolAccessGrant;
  signal?: AbortSignal;
  runtime?: Partial<
    Pick<
      AgentPiTurnStateOptions,
      "sessionId" | "requestId" | "step" | "rootCommand" | "activeSkills" | "toolExposure" | "toolPlan" | "tokenBudget"
    >
  >;
}

export interface AgentPiPlanningCompilerPort {
  compile(input: AgentPiPlanningCompileRequest): Promise<AgentPiAssistantCompilation>;
  summarize(input: AgentPiCompactionPromptInput, options?: AgentPiPlanningSummaryOptions): Promise<string>;
}

export interface AgentPiPlanningSummaryOptions {
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
}

export interface AgentPiPlanningCompilerFactory {
  create(options?: { usageSink?: AgentModelUsageSink; timingSink?: AgentModelTimingSink }): AgentPiPlanningCompilerPort;
}

export interface AgentPiPlanningModelClient {
  /** Undefined preserves compatibility with custom planner clients. */
  readonly supportsVisualInput?: boolean;
  evolveTurn(input: AgentPiControllerDecisionInput, options?: AgentLanguageModelInvocationOptions): Promise<unknown>;
  repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown>;
  fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown>;
  repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown>;
  summarizePiConversation(
    input: AgentPiCompactionPromptInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown>;
}

interface AgentPiToolChoiceConstraint {
  mode: "auto" | "none" | "required" | "specific" | "allowed";
  allowedTools: string[];
  toolsRequired: boolean;
  requiredToolName?: string;
}

interface AgentPiControllerContext {
  input: AgentPiControllerDecisionInput;
  toolContracts: ReadonlyMap<string, AgentPiToolContract>;
}

interface AgentPiMaterializableToolCall {
  readonly call: AgentPiPlannedToolCall;
  readonly planIndex: number;
  readonly nodeId?: string;
  readonly preface: string;
}

export class AgentPiPlanningCompiler implements AgentPiPlanningCompilerPort {
  private readonly client: AgentPiPlanningModelClient;
  private readonly contextCompiler: AgentPiPlanningContextCompiler;
  private readonly tokenProjector: AgentTokenProjector;

  constructor(private readonly options: AgentPiPlanningCompilerOptions) {
    this.contextCompiler = new AgentPiPlanningContextCompiler({
      modelProvider: options.modelProvider,
    });
    this.tokenProjector = new AgentTokenProjector(options.modelProvider.Model);
    this.client = options.client;
  }

  async compile(input: AgentPiPlanningCompileRequest): Promise<AgentPiAssistantCompilation> {
    const toolExposure = input.runtime?.toolExposure?.snapshot() ?? {
      generation: 0,
      exposedToolNames: input.toolAccessGrant.exposedToolNames,
      preferredToolNames: input.toolAccessGrant.preferredToolNames,
    };
    const toolChoice = resolveToolChoiceConstraint(input.context, input.toolAccessGrant, toolExposure.exposedToolNames);
    const attachments =
      input.model.input.includes("image") && this.client.supportsVisualInput !== false
        ? projectContextImageAttachments(input.context)
        : [];
    let controller = this.buildControllerContext(input, toolChoice.allowedTools, attachments);
    const toolPlan = input.runtime?.toolPlan;
    toolPlan?.reconcile(controller.input.planningContext.toolTranscript);
    controller.input.seneraRuntime.planState = toolPlan?.state();

    // Reconciliation can add terminal plan state after the first projection. Keep
    // the final planner payload within the same canonical budget before invoking
    // the model, rather than relying on the provider to reject it later.
    const finalInspection = input.runtime?.tokenBudget?.inspectModelInput({
      promptInput: controller.input,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    if (finalInspection && !finalInspection.fits) {
      controller = this.buildControllerContext(input, toolChoice.allowedTools, attachments);
      controller.input.seneraRuntime.planState = toolPlan?.state();
    }
    const promptInput = controller.input;
    const cache = input.runtime?.sessionId
      ? createAgentPiPromptCacheOptions({
          phase: "baml-planning",
          sessionId: input.runtime.sessionId,
          model: { provider: input.model.provider, api: input.model.api, model: input.model.id },
          stablePrefix: {
            systemPrompt: input.context.systemPrompt,
            tools:
              input.context.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })) ??
              [],
          },
        })
      : undefined;
    const modelOptions: AgentLanguageModelInvocationOptions = {
      ...(input.signal ? { signal: input.signal } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(cache ? { cache } : {}),
    };
    input.runtime?.tokenBudget?.validateModelInput({
      promptInput,
      attachments: modelOptions.attachments,
    });
    const pendingCalls = toolPlan?.ready(promptInput.planningContext.toolExecution === "parallel") ?? [];
    if (pendingCalls.length > 0) {
      return this.projectToolCalls(pendingCalls, promptInput, controller.toolContracts, modelOptions, toolPlan);
    }
    const decision = await this.evolveTurn(promptInput, toolChoice, modelOptions, toolPlan);

    return this.projectDecision(decision, promptInput, controller.toolContracts, modelOptions, toolPlan);
  }

  async summarize(input: AgentPiCompactionPromptInput, options: AgentPiPlanningSummaryOptions = {}): Promise<string> {
    const cache = options.sessionId
      ? createAgentPiPromptCacheOptions({
          phase: "baml-compaction",
          sessionId: options.sessionId,
          model: projectAgentPiPromptCacheModel(this.options.modelProvider),
        })
      : undefined;
    const result = await this.client.summarizePiConversation(input, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(cache ? { cache } : {}),
    });
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Pi compaction compiler returned an invalid summary object.");
    }
    const summary = (result as { summary?: unknown }).summary;
    if (typeof summary !== "string" || summary.trim().length === 0) {
      throw new Error("Pi compaction compiler returned an empty summary.");
    }
    return summary.trim();
  }

  private async evolveTurn(
    input: AgentPiControllerDecisionInput,
    toolChoice: AgentPiToolChoiceConstraint,
    modelOptions: AgentLanguageModelInvocationOptions,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<ParsedControllerDecision> {
    const rawDecision = await this.client.evolveTurn(input, modelOptions);
    try {
      return this.parseDecision(rawDecision, toolChoice, toolPlan);
    } catch (error) {
      if (!isPlannerValidationError(error)) {
        throw error;
      }
      const repaired = await this.client.repairControllerDecision(
        {
          input,
          invalidDecision: stringifyForRepair(rawDecision),
          issues: error.issues,
        },
        modelOptions,
      );
      return this.parseDecision(repaired, toolChoice, toolPlan);
    }
  }

  private parseDecision(
    rawDecision: unknown,
    toolChoice: AgentPiToolChoiceConstraint,
    toolPlan?: AgentPiToolPlanCoordinator,
  ): ParsedControllerDecision {
    const decision = parseControllerDecision(rawDecision, {
      allowedTools: toolChoice.allowedTools,
    });
    const issues = [
      ...validateDecisionToolChoice(decision, toolChoice),
      ...validateDecisionExecutionReadiness(decision),
      ...validateAgentPiCompletion(decision, toolPlan),
    ];
    if (issues.length > 0) {
      throw new AgentStructuredOutputValidationError(issues, decision);
    }
    return decision;
  }

  private async projectDecision(
    decision: ParsedControllerDecision,
    input: AgentPiControllerDecisionInput,
    toolContracts: ReadonlyMap<string, AgentPiToolContract>,
    modelOptions: AgentLanguageModelInvocationOptions,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<AgentPiAssistantCompilation> {
    return matchByKind(decision, {
      Direct: async (direct) => ({
        kind: "final_text" as const,
        content: direct.response,
        toolCalls: [],
      }),
      AskUser: async (ask) => ({
        kind: "final_text" as const,
        content: ask.question,
        toolCalls: [],
      }),
      Execute: (execute) => this.projectToolCallsDecision(execute, input, toolContracts, modelOptions, toolPlan),
    });
  }

  private async projectToolCallsDecision(
    decision: Extract<ParsedControllerDecision, { kind: "Execute" }>,
    input: AgentPiControllerDecisionInput,
    toolContracts: ReadonlyMap<string, AgentPiToolContract>,
    modelOptions: AgentLanguageModelInvocationOptions,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<AgentPiAssistantMessage> {
    const parallelToolCalls = input.planningContext.toolExecution === "parallel";
    const fragment = decision.fragment;
    const readyCalls = toolPlan
      ? this.acceptToolPlan(toolPlan, fragment, parallelToolCalls)
      : this.readyCalls(fragment.calls, parallelToolCalls).map((entry) => ({
          ...entry,
          preface: fragment.preface,
        }));
    if (readyCalls.length === 0) {
      throw new AgentStructuredOutputValidationError([agentErrorMessage("pi.executeMissingReadyCall")], decision);
    }

    return this.projectToolCalls(readyCalls, input, toolContracts, modelOptions, toolPlan);
  }

  private acceptToolPlan(
    toolPlan: AgentPiToolPlanCoordinator,
    fragment: Extract<ParsedControllerDecision, { kind: "Execute" }>["fragment"],
    parallelToolCalls: boolean,
  ): AgentPiReadyToolPlanNode[] {
    toolPlan.accept(fragment.preface, fragment.calls);
    return toolPlan.ready(parallelToolCalls);
  }

  private async projectToolCalls(
    readyCalls: readonly AgentPiMaterializableToolCall[],
    input: AgentPiControllerDecisionInput,
    toolContracts: ReadonlyMap<string, AgentPiToolContract>,
    modelOptions: AgentLanguageModelInvocationOptions,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<AgentPiAssistantMessage> {
    const materialized = await Promise.all(
      readyCalls.map((entry) => this.materializeToolCall(entry, input, toolContracts, modelOptions)),
    );
    for (const entry of materialized) {
      if (!entry.ok && entry.entry.nodeId) toolPlan?.reject(entry.entry.nodeId, entry.message);
    }
    const requiredFailure = materialized.find((entry) => !entry.ok && entry.required);
    if (requiredFailure && !requiredFailure.ok) {
      for (const entry of materialized) {
        if (entry.ok && entry.entry.nodeId) {
          toolPlan?.reject(entry.entry.nodeId, agentErrorMessage("pi.requiredSiblingInvalid"));
        }
      }
      return {
        kind: "final_text",
        content: requiredFailure.message,
        toolCalls: [],
      };
    }

    const executable = materialized.flatMap((entry) => (entry.ok ? [entry.call] : []));
    if (executable.length === 0) {
      throw new AgentStructuredOutputValidationError([agentErrorMessage("pi.noExecutableToolCalls")], readyCalls);
    }

    for (const entry of materialized) {
      if (!entry.ok || !entry.entry.nodeId) continue;
      const callId = entry.call.id;
      if (!callId) {
        throw new AgentStructuredOutputValidationError(
          [agentErrorMessage("pi.materializedToolCallMissingId")],
          entry.call,
        );
      }
      toolPlan?.dispatch(entry.entry.nodeId, callId);
    }

    return {
      kind: "tool_calls",
      content: readyCalls.find((entry) => entry.preface)?.preface ?? "",
      toolCalls: executable,
    };
  }

  private async materializeToolCall(
    entry: AgentPiMaterializableToolCall,
    input: AgentPiControllerDecisionInput,
    toolContracts: ReadonlyMap<string, AgentPiToolContract>,
    modelOptions: AgentLanguageModelInvocationOptions,
  ): Promise<
    | {
        ok: true;
        call: NonNullable<AgentPiAssistantMessage["toolCalls"][number]>;
        entry: AgentPiMaterializableToolCall;
      }
    | {
        ok: false;
        required: boolean;
        message: string;
        entry: AgentPiMaterializableToolCall;
      }
  > {
    const tool = toolContracts.get(entry.call.toolName);
    if (!tool) {
      return {
        ok: false,
        required: entry.call.required,
        message: agentErrorMessage("pi.toolUnavailable", { toolName: entry.call.toolName }),
        entry,
      };
    }

    const argumentInput: AgentPiToolArgumentsInput = {
      planningContext: input.planningContext,
      call: {
        ...entry.call,
        planIndex: entry.planIndex,
      },
      tool,
      seneraRuntime: input.seneraRuntime,
    };
    const draft = await this.resolveArguments(argumentInput, modelOptions);
    const issues = this.argumentDraftIssues(draft, tool);
    if (issues.length > 0) {
      return {
        ok: false,
        required: entry.call.required,
        message: formatArgumentFailure(entry.call, issues),
        entry,
      };
    }

    return {
      ok: true,
      call: {
        id: createToolCallId(),
        name: entry.call.toolName,
        arguments: draft.arguments,
        purpose: entry.call.purpose,
      },
      entry,
    };
  }

  private async resolveArguments(
    input: AgentPiToolArgumentsInput,
    modelOptions: AgentLanguageModelInvocationOptions,
  ): Promise<ParsedPiToolArgumentsDraft> {
    const draft = parsePiToolArgumentsDraft(await this.client.fillPiToolArguments(input, modelOptions));
    const issues = this.argumentDraftIssues(draft, input.tool);
    if (issues.length === 0) {
      return draft;
    }

    return parsePiToolArgumentsDraft(
      await this.client.repairPiToolArguments(
        {
          ...input,
          invalidArguments: draft.arguments,
          issues,
        },
        modelOptions,
      ),
    );
  }

  private argumentDraftIssues(
    draft: Pick<ParsedPiToolArgumentsDraft, "arguments" | "missingInputs">,
    tool: AgentPiToolContract,
  ): string[] {
    const missing = draft.missingInputs
      .map((input) => input.trim())
      .filter(Boolean)
      .map((input) => `missing input: ${input}`);
    return [...missing, ...validateJsonSchema(tool.parameters ?? EmptyObjectParameterSchema, draft.arguments)];
  }

  private readyCalls(
    calls: readonly AgentPiPlannedToolCall[],
    parallelToolCalls: boolean,
  ): Array<{
    call: AgentPiPlannedToolCall;
    planIndex: number;
  }> {
    const ready = calls.flatMap((call, index) =>
      (call.dependsOn ?? []).length === 0
        ? [
            {
              call,
              planIndex: index,
            },
          ]
        : [],
    );
    return parallelToolCalls ? ready : ready.slice(0, 1);
  }

  private buildControllerContext(
    input: AgentPiPlanningCompileRequest,
    allowedTools: string[],
    attachments: readonly AgentLanguageModelImageAttachment[],
  ): AgentPiControllerContext {
    const tools = input.context.tools ?? [];
    const allowed = new Set(allowedTools);
    const selectedByName = new Map(tools.filter((tool) => allowed.has(tool.name)).map((tool) => [tool.name, tool]));
    const selectedTools = orderToolNamesByPreference(
      [...selectedByName.keys()],
      input.runtime?.toolExposure?.snapshot().preferredToolNames ?? input.toolAccessGrant.preferredToolNames,
    ).flatMap((toolName) => {
      const tool = selectedByName.get(toolName);
      return tool ? [tool] : [];
    });
    const conversationSummaryText = this.contextCompiler.detectCompactionSummaryText(input.context.messages);
    const seneraRuntime: AgentPiAssistantMessageCompileInput["seneraRuntime"] = {
      protocols: {
        contextPolicy: AgentPiContextPolicyProtocol,
      },
      modelProviderId: this.options.modelProvider.Id,
      model: this.options.modelProvider.Model,
      toolAccessGrant: input.toolAccessGrant,
      toolExposure: input.runtime?.toolExposure?.snapshot() ?? {
        generation: 0,
        exposedToolNames: input.toolAccessGrant.exposedToolNames,
        preferredToolNames: input.toolAccessGrant.preferredToolNames,
      },
      rootCommand: input.runtime?.rootCommand,
      activeSkills: input.runtime?.activeSkills,
      planState: input.runtime?.toolPlan?.state(),
      ...(conversationSummaryText ? { conversationSummaryText } : {}),
    };
    const context = { ...input.context, tools: selectedTools };
    let reservedTokens = this.tokenProjector.countJson({ seneraRuntime });
    const tokenBudget = input.runtime?.tokenBudget;
    while (true) {
      const compilation = this.contextCompiler.compile({
        model: input.model.id,
        context,
        maxTokens: input.options?.maxTokens,
        reservedTokens,
        toolExecution: "parallel",
      });
      const controller: AgentPiControllerContext = {
        input: {
          planningContext: compilation.planningContext,
          routingCards: compilation.routingCards,
          seneraRuntime,
        },
        toolContracts: compilation.toolContracts,
      };
      if (!tokenBudget) return controller;

      const inspection = tokenBudget.inspectModelInput({
        promptInput: controller.input,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (inspection.fits) return controller;

      const excessTokens = inspection.tokenCount - inspection.capacityTokens;
      const nextReservedTokens = reservedTokens + Math.max(1, Math.ceil(excessTokens));
      const reservationCeiling = Math.max(1, Math.floor(tokenBudget.contextWindowTokens));
      if (!Number.isFinite(excessTokens) || excessTokens <= 0 || nextReservedTokens >= reservationCeiling) {
        return controller;
      }
      reservedTokens = nextReservedTokens;
    }
  }
}

function projectContextImageAttachments(context: Context): AgentLanguageModelImageAttachment[] {
  const currentUserMessage = [...context.messages].reverse().find((message) => message.role === "user");
  if (!currentUserMessage || typeof currentUserMessage.content === "string") return [];
  return currentUserMessage.content.flatMap((part) =>
    part.type === "image"
      ? [
          {
            type: "image" as const,
            data: part.data,
            mimeType: part.mimeType,
          },
        ]
      : [],
  );
}

function validateJsonSchema(schema: unknown, value: Record<string, unknown>): string[] {
  const normalized = normalizeParameterSchema(schema);
  try {
    return validateToolContractValue({ schema: normalized, value }).map((issue) =>
      formatAgentToolContractValidationIssue(issue, "arguments"),
    );
  } catch (error) {
    return [`tool schema is invalid: ${errorMessage(error)}`];
  }
}

function normalizeParameterSchema(schema: unknown): Record<string, unknown> {
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as Record<string, unknown>)
    : EmptyObjectParameterSchema;
}

function formatArgumentFailure(call: AgentPiPlannedToolCall, issues: readonly string[]): string {
  return [agentErrorMessage("pi.toolArgumentsUnsafe", { toolName: call.toolName }), ...issues.slice(0, 6)].join("\n");
}

function resolveToolChoiceConstraint(
  context: Context,
  toolAccessGrant: AgentToolAccessGrant,
  exposedToolNames: readonly string[],
): AgentPiToolChoiceConstraint {
  const requestedToolNames = (context.tools ?? []).map((tool) => tool.name);
  const granted = new Set(toolAccessGrant.authorizedToolNames);
  const ungranted = requestedToolNames.filter((toolName) => !granted.has(toolName));
  if (ungranted.length > 0) {
    throw new AgentLocalizedError("pi.requestToolOutsideGrant", {
      toolNames: [...new Set(ungranted)].join(", "),
    });
  }
  const exposed = new Set(exposedToolNames);
  const requestTools = requestedToolNames.filter((toolName) => exposed.has(toolName));
  if (requestTools.length === 0) {
    return {
      mode: "none",
      allowedTools: [],
      toolsRequired: false,
    };
  }

  return {
    mode: "auto",
    allowedTools: requestTools,
    toolsRequired: false,
  };
}

function validateDecisionToolChoice(
  decision: ParsedControllerDecision,
  toolChoice: AgentPiToolChoiceConstraint,
): string[] {
  const issues: string[] = [];
  if (toolChoice.mode === "none" && decision.kind === "Execute") {
    issues.push(agentErrorMessage("pi.toolChoiceForbidsTools"));
  }
  if (toolChoice.toolsRequired && decision.kind !== "Execute") {
    issues.push(agentErrorMessage("pi.toolChoiceRequiresTool"));
  }
  if (toolChoice.requiredToolName && decision.kind === "Execute") {
    const invalid = decision.fragment.calls.find((call) => call.toolName !== toolChoice.requiredToolName);
    if (invalid) {
      issues.push(
        agentErrorMessage("pi.toolChoiceRequiresNamedTool", {
          toolName: toolChoice.requiredToolName,
        }),
      );
    }
  }
  if (toolChoice.toolsRequired && toolChoice.allowedTools.length === 0) {
    issues.push(agentErrorMessage("pi.toolChoiceWithoutAvailableTool"));
  }
  return issues;
}

function validateDecisionExecutionReadiness(decision: ParsedControllerDecision): string[] {
  if (decision.kind !== "Execute") {
    return [];
  }
  const calls = decision.fragment.calls;
  return calls.some((call) => (call.dependsOn ?? []).length === 0)
    ? []
    : [agentErrorMessage("pi.executeMissingReadyCall")];
}

function isPlannerValidationError(error: unknown): error is AgentStructuredOutputValidationError {
  return error instanceof AgentStructuredOutputValidationError;
}

function stringifyForRepair(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
