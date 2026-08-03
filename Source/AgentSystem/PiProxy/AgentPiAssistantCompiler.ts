import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentStructuredOutputValidationError } from "../Diagnostics/AgentStructuredOutputValidationError.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { agentUnknownRecordOrEmpty } from "../Core/AgentUnknownValue.js";
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
import type { PiOpenAiChatCompletionRequest, PiOpenAiTool } from "./AgentPiOpenAiWireTypes.js";
import { AgentPiOpenAiPlanningProjector } from "./AgentPiOpenAiPlanningProjector.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { formatAjvIssue } from "../Diagnostics/AgentValidationIssue.js";
import type { AgentPiReadyToolPlanNode, AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { orderToolNamesByPreference, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { validateAgentPiCompletion } from "./AgentPiCompletionGate.js";
import { AgentPiContextPolicyProtocol } from "../PiShared/AgentPiContextPolicyProtocol.js";
import type { AgentPiTurnContext } from "../PiShared/AgentPiTurnContext.js";

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

export interface AgentPiAssistantCompilerOptions {
  modelProvider: ResolvedAgentModelProviderConfig;
  client: AgentPiAssistantCompilerModelClient;
}

export interface AgentPiAssistantCompileRequest {
  request: PiOpenAiChatCompletionRequest;
  toolAccessGrant: AgentToolAccessGrant;
  signal?: AbortSignal;
  runtime?: Partial<
    Pick<
      AgentPiTurnContext,
      "sessionId" | "requestId" | "step" | "rootCommand" | "activeSkills" | "toolExposure" | "toolPlan" | "tokenBudget"
    >
  >;
}

export interface AgentPiAssistantCompilerPort {
  compile(input: AgentPiAssistantCompileRequest): Promise<AgentPiAssistantCompilation>;
}

export interface AgentPiAssistantCompilerModelClient {
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

export class AgentPiAssistantCompiler implements AgentPiAssistantCompilerPort {
  private readonly client: AgentPiAssistantCompilerModelClient;
  private readonly planningProjector: AgentPiOpenAiPlanningProjector;

  constructor(private readonly options: AgentPiAssistantCompilerOptions) {
    this.planningProjector = new AgentPiOpenAiPlanningProjector({
      modelProvider: options.modelProvider,
    });
    this.client = options.client;
  }

  async compile(input: AgentPiAssistantCompileRequest): Promise<AgentPiAssistantCompilation> {
    const toolExposure = input.runtime?.toolExposure?.snapshot() ?? {
      generation: 0,
      exposedToolNames: input.toolAccessGrant.exposedToolNames,
      preferredToolNames: input.toolAccessGrant.preferredToolNames,
    };
    const toolChoice = resolveToolChoiceConstraint(input.request, input.toolAccessGrant, toolExposure.exposedToolNames);
    const controller = this.buildControllerContext(input, toolChoice.allowedTools);
    const promptInput = controller.input;
    input.runtime?.tokenBudget?.observeModelInput(promptInput);
    const toolPlan = input.runtime?.toolPlan;
    toolPlan?.reconcile(promptInput.openAiRequest.toolTranscript);
    promptInput.seneraRuntime.planState = toolPlan?.state();
    const pendingCalls = toolPlan?.ready(promptInput.openAiRequest.parallelToolCalls !== false) ?? [];
    if (pendingCalls.length > 0) {
      return this.projectToolCalls(pendingCalls, promptInput, controller.toolContracts, input.signal, toolPlan);
    }
    const decision = await this.evolveTurn(promptInput, toolChoice, input.signal, toolPlan);

    return this.projectDecision(decision, promptInput, controller.toolContracts, input.signal, toolPlan);
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
    const parallelToolCalls = input.openAiRequest.parallelToolCalls !== false;
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
      openAiRequest: input.openAiRequest,
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
    input: AgentPiAssistantCompileRequest,
    allowedTools: string[],
  ): AgentPiControllerContext {
    const tools = input.request.tools ?? [];
    const base = this.buildPromptInput(input);
    const allowed = new Set(allowedTools);
    const selectedByName = new Map(
      tools.filter((tool) => allowed.has(tool.function.name)).map((tool) => [tool.function.name, tool]),
    );
    const selectedTools = orderToolNamesByPreference(
      [...selectedByName.keys()],
      input.runtime?.toolExposure?.snapshot().preferredToolNames ?? input.toolAccessGrant.preferredToolNames,
    ).flatMap((toolName) => {
      const tool = selectedByName.get(toolName);
      return tool ? [tool] : [];
    });
    return {
      input: {
        ...base,
        routingCards: this.planningProjector.projectToolCards(selectedTools),
      },
      toolContracts: new Map(selectedTools.map((tool) => [tool.function.name, authoritativeToolCard(tool)])),
    };
  }

  private buildPromptInput(input: AgentPiAssistantCompileRequest): AgentPiAssistantMessageCompileInput {
    const conversationSummaryText = this.planningProjector.detectCompactionSummaryText(input.request.messages);
    return {
      openAiRequest: this.planningProjector.project(input.request),
      seneraRuntime: {
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
        ...(conversationSummaryText ? { conversationSummaryText } : {}),
      },
    };
  }
}

function authoritativeToolCard(tool: PiOpenAiTool): AgentPiToolContract {
  return deepFreeze({
    name: tool.function.name,
    description: tool.function.description,
    parameters: structuredClone(tool.function.parameters),
  });
}

function toolNames(tools: readonly PiOpenAiTool[]): string[] {
  return tools.map((tool) => tool.function.name);
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
  request: PiOpenAiChatCompletionRequest,
  toolAccessGrant: AgentToolAccessGrant,
  exposedToolNames: readonly string[],
): AgentPiToolChoiceConstraint {
  const requestedToolNames = toolNames(request.tools ?? []);
  const granted = new Set(toolAccessGrant.authorizedToolNames);
  const ungranted = requestedToolNames.filter((toolName) => !granted.has(toolName));
  if (ungranted.length > 0) {
    throw new AgentLocalizedError("pi.requestToolOutsideGrant", {
      toolNames: [...new Set(ungranted)].join(", "),
    });
  }
  const exposed = new Set(exposedToolNames);
  const requestTools = requestedToolNames.filter((toolName) => exposed.has(toolName));
  const allowedToolChoice = readAllowedToolChoice(request.tool_choice, requestTools);
  if (allowedToolChoice) {
    return allowedToolChoice;
  }

  const forcedToolName = readForcedToolChoiceName(request.tool_choice);
  if (forcedToolName) {
    return {
      mode: "specific",
      allowedTools: requestTools.includes(forcedToolName) ? [forcedToolName] : [],
      toolsRequired: true,
      requiredToolName: forcedToolName,
    };
  }

  if (request.tool_choice === "none" || requestTools.length === 0) {
    return {
      mode: "none",
      allowedTools: [],
      toolsRequired: false,
    };
  }

  if (request.tool_choice === "required") {
    return {
      mode: "required",
      allowedTools: requestTools,
      toolsRequired: true,
    };
  }

  return {
    mode: "auto",
    allowedTools: requestTools,
    toolsRequired: false,
  };
}

function readAllowedToolChoice(
  toolChoice: unknown,
  requestTools: readonly string[],
): AgentPiToolChoiceConstraint | undefined {
  if (!toolChoice || typeof toolChoice !== "object" || Array.isArray(toolChoice)) {
    return undefined;
  }
  const record = toolChoice as Record<string, unknown>;
  if (record.type !== "allowed_tools") {
    return undefined;
  }
  const allowedToolsRecord = agentUnknownRecordOrEmpty(record.allowed_tools);
  const declaredTools = Array.isArray(allowedToolsRecord.tools) ? allowedToolsRecord.tools : [];
  const declaredNames = new Set(
    declaredTools.flatMap((tool) => {
      const name = readFunctionToolName(tool);
      return name ? [name] : [];
    }),
  );
  return {
    mode: "allowed",
    allowedTools: requestTools.filter((name) => declaredNames.has(name)),
    toolsRequired: allowedToolsRecord.mode === "required",
  };
}

function readForcedToolChoiceName(toolChoice: unknown): string | undefined {
  return readFunctionToolName(toolChoice);
}

function readFunctionToolName(toolChoice: unknown): string | undefined {
  if (!toolChoice || typeof toolChoice !== "object" || Array.isArray(toolChoice)) {
    return undefined;
  }
  const record = toolChoice as Record<string, unknown>;
  if (record.type !== "function") {
    return undefined;
  }
  const fn = record.function;
  if (!fn || typeof fn !== "object" || Array.isArray(fn)) {
    return undefined;
  }
  const name = (fn as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name : undefined;
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
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
