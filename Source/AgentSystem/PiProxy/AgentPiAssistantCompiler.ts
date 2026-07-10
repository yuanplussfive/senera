import * as AjvModule from "ajv";
import type {
  ErrorObject,
  ValidateFunction,
} from "ajv";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { ResolvedAgentActionPlannerConfig } from "../Types/AgentConfigTypes.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentActionPlannerValidationError } from "../ActionPlanner/AgentActionPlannerSchema.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  parsePiControllerAction,
  parsePiToolArgumentsDraft,
  type ParsedPiControllerAction,
  type ParsedPiToolArgumentsDraft,
} from "./AgentPiAssistantMessageSchema.js";
import type {
  AgentPiAssistantMessage,
  AgentPiAssistantMessageCompileInput,
  AgentPiControllerActionInput,
  AgentPiPlannedToolCall,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
  AgentPiToolCard,
} from "./AgentPiAssistantMessageTypes.js";
import type {
  PiOpenAiChatCompletionRequest,
  PiOpenAiTool,
} from "./AgentPiOpenAiWireTypes.js";
import { AgentPiOpenAiPlanningProjector } from "./AgentPiOpenAiPlanningProjector.js";

const Ajv = (AjvModule.default ?? AjvModule) as unknown as typeof import("ajv").default;

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
  actionPlannerConfig: ResolvedAgentActionPlannerConfig;
  client?: AgentPiAssistantCompilerModelClient;
}

export interface AgentPiAssistantCompileRequest {
  request: PiOpenAiChatCompletionRequest;
  signal?: AbortSignal;
  runtime?: {
    rootCommand?: unknown;
    activeSkills?: unknown[];
  };
}

export interface AgentPiAssistantCompilerPort {
  compile(input: AgentPiAssistantCompileRequest): Promise<AgentPiAssistantMessage>;
}

export interface AgentPiAssistantCompilerModelClient {
  selectPiAction(
    input: AgentPiControllerActionInput,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  repairPiAction(options: {
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<unknown>;
  fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

interface AgentPiToolChoiceConstraint {
  mode: "auto" | "none" | "required" | "specific" | "allowed";
  allowedTools: string[];
  toolsRequired: boolean;
  requiredToolName?: string;
}

export class AgentPiAssistantCompiler implements AgentPiAssistantCompilerPort {
  private readonly client: AgentPiAssistantCompilerModelClient;
  private readonly planningProjector: AgentPiOpenAiPlanningProjector;

  constructor(private readonly options: AgentPiAssistantCompilerOptions) {
    this.planningProjector = new AgentPiOpenAiPlanningProjector({
      modelProvider: options.modelProvider,
    });
    this.client = options.client ?? new AgentActionPlannerModelClient(
      options.modelProvider,
      options.actionPlannerConfig.Client,
      {
        maxRepairAttempts: options.actionPlannerConfig.MaxRepairAttempts,
      },
    );
  }

  async compile(input: AgentPiAssistantCompileRequest): Promise<AgentPiAssistantMessage> {
    const toolChoice = resolveToolChoiceConstraint(input.request);
    const promptInput = this.buildControllerInput(input, toolChoice.allowedTools);
    const action = await this.selectAction(promptInput, toolChoice, input.signal);

    return this.projectAction(action, promptInput, input.signal);
  }

  private async selectAction(
    input: AgentPiControllerActionInput,
    toolChoice: AgentPiToolChoiceConstraint,
    signal: AbortSignal | undefined,
  ): Promise<ParsedPiControllerAction> {
    const rawAction = await this.client.selectPiAction(input, {
      signal,
    });
    try {
      return this.parseAction(rawAction, toolChoice);
    } catch (error) {
      if (!isPlannerValidationError(error)) {
        throw error;
      }
      const repaired = await this.client.repairPiAction({
        input,
        invalidAction: stringifyForRepair(rawAction),
        issues: error.issues,
      }, {
        signal,
      });
      return this.parseAction(repaired, toolChoice);
    }
  }

  private parseAction(
    rawAction: unknown,
    toolChoice: AgentPiToolChoiceConstraint,
  ): ParsedPiControllerAction {
    const action = parsePiControllerAction(rawAction, {
      allowedTools: toolChoice.allowedTools,
    });
    const issues = [
      ...validateActionToolChoice(action, toolChoice),
      ...validateActionExecutionReadiness(action),
    ];
    if (issues.length > 0) {
      throw new AgentActionPlannerValidationError(issues, action);
    }
    return action;
  }

  private async projectAction(
    action: ParsedPiControllerAction,
    input: AgentPiControllerActionInput,
    signal: AbortSignal | undefined,
  ): Promise<AgentPiAssistantMessage> {
    const projectors = {
      FinalAnswer: async () => ({
        kind: "final_text" as const,
        content: action.answer?.trim() ?? "",
        toolCalls: [],
      }),
      AskUser: async () => ({
        kind: "final_text" as const,
        content: action.question?.trim() ?? "",
        toolCalls: [],
      }),
      CallTools: async () => this.projectToolCallsAction(action, input, signal),
    } satisfies Record<ParsedPiControllerAction["kind"], () => Promise<AgentPiAssistantMessage>>;

    return projectors[action.kind]();
  }

  private async projectToolCallsAction(
    action: ParsedPiControllerAction,
    input: AgentPiControllerActionInput,
    signal: AbortSignal | undefined,
  ): Promise<AgentPiAssistantMessage> {
    const readyCalls = this.readyCalls(
      action.calls ?? [],
      input.openAiRequest.parallelToolCalls !== false,
    );
    if (readyCalls.length === 0) {
      throw new AgentActionPlannerValidationError([
        "CallTools must include at least one immediately executable call.",
      ], action);
    }

    const materialized = await Promise.all(
      readyCalls.map((entry) => this.materializeToolCall(entry, input, signal)),
    );
    const requiredFailure = materialized.find((entry) => !entry.ok && entry.required);
    if (requiredFailure && !requiredFailure.ok) {
      return {
        kind: "final_text",
        content: requiredFailure.message,
        toolCalls: [],
      };
    }

    const executable = materialized.flatMap((entry) => entry.ok ? [entry.call] : []);
    if (executable.length === 0) {
      throw new AgentActionPlannerValidationError([
        "No tool calls were executable after argument validation.",
      ], action);
    }

    return {
      kind: "tool_calls",
      content: action.preface?.trim() ?? "",
      toolCalls: executable,
    };
  }

  private async materializeToolCall(
    entry: {
      call: AgentPiPlannedToolCall;
      planIndex: number;
    },
    input: AgentPiControllerActionInput,
    signal: AbortSignal | undefined,
  ): Promise<
    | {
        ok: true;
        call: NonNullable<AgentPiAssistantMessage["toolCalls"][number]>;
      }
    | {
        ok: false;
        required: boolean;
        message: string;
      }
  > {
    const tool = input.candidateTools.find((candidate) => candidate.name === entry.call.toolName);
    if (!tool) {
      return {
        ok: false,
        required: entry.call.required,
        message: agentErrorMessage("pi.toolUnavailable", { toolName: entry.call.toolName }),
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
      };
    }

    return {
      ok: true,
      call: {
        id: createToolCallId(),
        name: entry.call.toolName,
        arguments: draft.arguments,
      },
    };
  }

  private async resolveArguments(
    input: AgentPiToolArgumentsInput,
    signal: AbortSignal | undefined,
  ): Promise<ParsedPiToolArgumentsDraft> {
    const hinted = this.argumentsFromHints(input);
    if (hinted) {
      return hinted;
    }

    const draft = parsePiToolArgumentsDraft(await this.client.fillPiToolArguments(input, {
      signal,
    }));
    const issues = this.argumentDraftIssues(draft, input.tool);
    if (issues.length === 0) {
      return draft;
    }

    return parsePiToolArgumentsDraft(await this.client.repairPiToolArguments({
      ...input,
      invalidArguments: draft.arguments,
      issues,
    }, {
      signal,
    }));
  }

  private argumentsFromHints(
    input: AgentPiToolArgumentsInput,
  ): ParsedPiToolArgumentsDraft | undefined {
    const hints = input.call.argumentHints;
    if (!hints) {
      return undefined;
    }

    const draft = parsePiToolArgumentsDraft({
      arguments: hints,
      missingInputs: [],
      assumptions: [],
    });
    return this.argumentDraftIssues(draft, input.tool).length === 0 ? draft : undefined;
  }

  private argumentDraftIssues(
    draft: Pick<ParsedPiToolArgumentsDraft, "arguments" | "missingInputs">,
    tool: AgentPiToolCard,
  ): string[] {
    const missing = draft.missingInputs
      .map((input) => input.trim())
      .filter(Boolean)
      .map((input) => `missing input: ${input}`);
    return [
      ...missing,
      ...validateJsonSchema(tool.parameters ?? EmptyObjectParameterSchema, draft.arguments),
    ];
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
        ? [{
            call,
            planIndex: index,
          }]
        : []);
    return parallelToolCalls ? ready : ready.slice(0, 1);
  }

  private buildControllerInput(
    input: AgentPiAssistantCompileRequest,
    allowedTools: string[],
  ): AgentPiControllerActionInput {
    const tools = input.request.tools ?? [];
    const base = this.buildPromptInput(input, allowedTools);
    const allowed = new Set(allowedTools);
    return {
      ...base,
      candidateTools: tools
        .filter((tool) => allowed.has(tool.function.name))
        .map((tool) => this.planningProjector.projectToolCard(tool)),
    };
  }

  private buildPromptInput(
    input: AgentPiAssistantCompileRequest,
    allowedTools: string[],
  ): AgentPiAssistantMessageCompileInput {
    return {
      openAiRequest: this.planningProjector.project(input.request),
      allowedTools,
      seneraRuntime: {
        modelProviderId: this.options.modelProvider.Id,
        model: this.options.modelProvider.Model,
        rootCommand: input.runtime?.rootCommand,
        activeSkills: input.runtime?.activeSkills,
      },
    };
  }
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
    : (validate.errors ?? []).map(formatAjvIssue);
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
    ? schema as Record<string, unknown>
    : EmptyObjectParameterSchema;
}

function formatAjvIssue(error: ErrorObject): string {
  const path = [
    ...jsonPointerPath(error.instancePath),
    ...ajvParamPath(error),
  ];
  const location = path.length > 0 ? path.map(String).join(".") : "arguments";
  return `${location}: ${error.message ?? "JSON Schema validation failed"}`;
}

function ajvParamPath(error: ErrorObject): Array<string | number> {
  const params = error.params as Record<string, unknown>;
  const property = params.additionalProperty ?? params.missingProperty;
  return typeof property === "string" && property.length > 0 ? [property] : [];
}

function jsonPointerPath(pointer: string): Array<string | number> {
  return pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => {
      const index = Number(segment);
      return Number.isInteger(index) && String(index) === segment ? index : segment;
    });
}

function formatArgumentFailure(
  call: AgentPiPlannedToolCall,
  issues: readonly string[],
): string {
  return [
    agentErrorMessage("pi.toolArgumentsUnsafe", { toolName: call.toolName }),
    ...issues.slice(0, 6),
  ].join("\n");
}

function resolveToolChoiceConstraint(
  request: PiOpenAiChatCompletionRequest,
): AgentPiToolChoiceConstraint {
  const requestTools = toolNames(request.tools ?? []);
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
  const allowedToolsRecord = readRecord(record.allowed_tools);
  const declaredTools = Array.isArray(allowedToolsRecord.tools)
    ? allowedToolsRecord.tools
    : [];
  const declaredNames = new Set(declaredTools.flatMap((tool) => {
    const name = readFunctionToolName(tool);
    return name ? [name] : [];
  }));
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validateActionToolChoice(
  action: ParsedPiControllerAction,
  toolChoice: AgentPiToolChoiceConstraint,
): string[] {
  const issues: string[] = [];
  if (toolChoice.mode === "none" && action.kind === "CallTools") {
    issues.push("tool_choice forbids tool calls.");
  }
  if (toolChoice.toolsRequired && action.kind !== "CallTools") {
    issues.push("tool_choice requires a tool call.");
  }
  if (toolChoice.requiredToolName && action.kind === "CallTools") {
    const invalid = (action.calls ?? []).find((call) => call.toolName !== toolChoice.requiredToolName);
    if (invalid) {
      issues.push(`tool_choice requires tool ${toolChoice.requiredToolName}.`);
    }
  }
  if (toolChoice.toolsRequired && toolChoice.allowedTools.length === 0) {
    issues.push("tool_choice references no available tool.");
  }
  return issues;
}

function validateActionExecutionReadiness(action: ParsedPiControllerAction): string[] {
  if (action.kind !== "CallTools") {
    return [];
  }
  const calls = action.calls ?? [];
  return calls.some((call) => (call.dependsOn ?? []).length === 0)
    ? []
    : ["CallTools must include at least one immediately executable call."];
}

function isPlannerValidationError(error: unknown): error is AgentActionPlannerValidationError {
  return error instanceof AgentActionPlannerValidationError;
}

function stringifyForRepair(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
