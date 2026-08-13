import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import type { Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
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
import { formatAjvIssue } from "../Diagnostics/AgentValidationIssue.js";
import type { AgentPiReadyToolPlanNode, AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { orderToolNamesByPreference, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { validateAgentPiCompletion } from "./AgentPiCompletionGate.js";
import { AgentPiContextPolicyProtocol } from "../PiShared/AgentPiContextPolicyProtocol.js";
import type { AgentPiTurnStateOptions } from "./AgentPiTurnState.js";
import type { AgentPiModelApi } from "./AgentPiTypes.js";
import type { AgentPiCompactionPromptInput } from "../PiShared/AgentPiCompactionPrompt.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});

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
  summarize(input: AgentPiCompactionPromptInput, signal?: AbortSignal): Promise<string>;
}

export interface AgentPiPlanningCompilerFactory {
  create(options?: { usageSink?: AgentModelUsageSink; timingSink?: AgentModelTimingSink }): AgentPiPlanningCompilerPort;
}

export interface AgentPiPlanningModelClient {
  evolveTurn(input: AgentPiControllerDecisionInput, options?: { signal?: AbortSignal }): Promise<unknown>;
  repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<unknown>;
  fillPiToolArguments(input: AgentPiToolArgumentsInput, options?: { signal?: AbortSignal }): Promise<unknown>;
  repairPiToolArguments(input: AgentPiToolArgumentsRepairInput, options?: { signal?: AbortSignal }): Promise<unknown>;
  summarizePiConversation(input: AgentPiCompactionPromptInput, options?: { signal?: AbortSignal }): Promise<unknown>;
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
    const controller = this.buildControllerContext(input, toolChoice.allowedTools);
    const promptInput = controller.input;
    input.runtime?.tokenBudget?.validateModelInput(promptInput);
    const toolPlan = input.runtime?.toolPlan;
    toolPlan?.reconcile(promptInput.planningContext.toolTranscript);
    promptInput.seneraRuntime.planState = toolPlan?.state();
    const pendingCalls = toolPlan?.ready(promptInput.planningContext.toolExecution === "parallel") ?? [];
    if (pendingCalls.length > 0) {
      return this.projectToolCalls(pendingCalls, promptInput, controller.toolContracts, input.signal, toolPlan);
    }
    const decision = await this.evolveTurn(promptInput, toolChoice, input.signal, toolPlan);

    return this.projectDecision(decision, promptInput, controller.toolContracts, input.signal, toolPlan);
  }

  async summarize(input: AgentPiCompactionPromptInput, signal?: AbortSignal): Promise<string> {
    const result = await this.client.summarizePiConversation(input, { signal });
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
    signal: AbortSignal | undefined,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<ParsedControllerDecision> {
    const rawDecision = await this.client.evolveTurn(input, {
      signal,
    });
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
        {
          signal,
        },
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
    signal: AbortSignal | undefined,
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
      Execute: (execute) => this.projectToolCallsDecision(execute, input, toolContracts, signal, toolPlan),
    });
  }

  private async projectToolCallsDecision(
    decision: Extract<ParsedControllerDecision, { kind: "Execute" }>,
    input: AgentPiControllerDecisionInput,
    toolContracts: ReadonlyMap<string, AgentPiToolContract>,
    signal: AbortSignal | undefined,
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

    return this.projectToolCalls(readyCalls, input, toolContracts, signal, toolPlan);
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
    signal: AbortSignal | undefined,
    toolPlan: AgentPiToolPlanCoordinator | undefined,
  ): Promise<AgentPiAssistantMessage> {
    const materialized = await Promise.all(
      readyCalls.map((entry) => this.materializeToolCall(entry, input, toolContracts, signal)),
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
    signal: AbortSignal | undefined,
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
    const draft = await this.resolveArguments(argumentInput, signal);
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
    signal: AbortSignal | undefined,
  ): Promise<ParsedPiToolArgumentsDraft> {
    const draft = parsePiToolArgumentsDraft(
      await this.client.fillPiToolArguments(input, {
        signal,
      }),
    );
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
        {
          signal,
        },
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
    const compilation = this.contextCompiler.compile({
      model: input.model.id,
      context: { ...input.context, tools: selectedTools },
      maxTokens: input.options?.maxTokens,
      reservedTokens: this.tokenProjector.countJson({ seneraRuntime }),
      toolExecution: "parallel",
    });
    return {
      input: {
        planningContext: compilation.planningContext,
        routingCards: compilation.routingCards,
        seneraRuntime,
      },
      toolContracts: compilation.toolContracts,
    };
  }
}

function validateJsonSchema(schema: unknown, value: Record<string, unknown>): string[] {
  let validate: ValidateFunction;
  try {
    validate = compileJsonSchema(schema);
  } catch (error) {
    return [`tool schema is invalid: ${errorMessage(error)}`];
  }
  return validate(value)
    ? []
    : (validate.errors ?? []).map((error) => formatAjvIssue(error, { rootLabel: "arguments" }));
}

const schemaValidatorCache = new WeakMap<object, ValidateFunction>();

function compileJsonSchema(schema: unknown): ValidateFunction {
  const normalized = normalizeParameterSchema(schema);
  const cached = schemaValidatorCache.get(normalized);
  if (cached) {
    return cached;
  }
  const validate = ajv.compile(normalized);
  schemaValidatorCache.set(normalized, validate);
  return validate;
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
