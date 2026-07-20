import { stableStringify } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentPiAssistantMessageCompileInput,
  AgentPiToolCard,
  AgentPiToolTranscriptItem,
} from "./AgentPiAssistantMessageTypes.js";
import type { PiOpenAiChatCompletionRequest, PiOpenAiTool } from "./AgentPiOpenAiWireTypes.js";

export interface AgentPiOpenAiPlanningProjectorOptions {
  modelProvider: Pick<ResolvedAgentModelProviderConfig, "ContextWindowTokens" | "MaxOutputTokens" | "Model">;
}

export interface AgentPiOpenAiPlanningProjectionStats {
  originalMessageCount: number;
  projectedMessageCount: number;
  omittedOlderMessages: number;
  truncatedTextFields: number;
  truncatedJsonFields: number;
  planningInputTokenBudget: number;
}

export interface AgentPiOpenAiPlanningProjectionLimits {
  maxMessages: number;
  messageTokens: number;
  toolMessageTokens: number;
  textPartTokens: number;
  jsonTokens: number;
  toolCatalogTokens: number;
  minToolCardTokens: number;
  maxToolCardTokens: number;
  planningInputTokenBudget: number;
}

interface ProjectionStatsAccumulator {
  truncatedTextFields: number;
  truncatedJsonFields: number;
}

const PiPlanningBudgetPolicy = {
  unknownContextWindowTokens: 128_000,
  defaultOutputReserveTokens: 8_192,
  inputBudgetRatio: 0.35,
  messagesPerTokenChunk: 1_024,
  minProjectedMessages: 12,
  maxProjectedMessages: 96,
  minMessageTokens: 2_000,
  maxMessageTokens: 12_000,
  minToolMessageTokens: 1_000,
  maxToolMessageTokens: 6_000,
  minJsonTokens: 1_000,
  maxJsonTokens: 6_000,
  minToolCatalogTokens: 2_048,
  maxToolCatalogTokens: 16_384,
  minToolCardTokens: 256,
  maxToolCardTokens: 2_048,
  toolDescriptionRatio: 0.25,
} as const;

export class AgentPiOpenAiPlanningProjector {
  private readonly limits: AgentPiOpenAiPlanningProjectionLimits;
  private readonly tokenProjector: AgentTokenProjector;

  constructor(options: AgentPiOpenAiPlanningProjectorOptions) {
    this.limits = resolveAgentPiOpenAiPlanningProjectionLimits(options.modelProvider);
    this.tokenProjector = new AgentTokenProjector(options.modelProvider.Model);
  }

  project(request: PiOpenAiChatCompletionRequest): AgentPiAssistantMessageCompileInput["openAiRequest"] {
    const stats: ProjectionStatsAccumulator = {
      truncatedTextFields: 0,
      truncatedJsonFields: 0,
    };
    const messages = this.projectMessages(request.messages, stats);
    return {
      model: request.model,
      messages: messages.items,
      toolTranscript: this.buildToolTranscript(request.messages, stats),
      toolChoice: request.tool_choice,
      parallelToolCalls: request.parallel_tool_calls,
      temperature: request.temperature,
      maxTokens: request.max_tokens ?? request.max_completion_tokens,
      stream: request.stream === true,
      projection: {
        originalMessageCount: request.messages.length,
        projectedMessageCount: messages.items.length,
        omittedOlderMessages: messages.omittedOlderMessages,
        truncatedTextFields: stats.truncatedTextFields,
        truncatedJsonFields: stats.truncatedJsonFields,
        planningInputTokenBudget: this.limits.planningInputTokenBudget,
      },
    };
  }

  projectToolCards(tools: readonly PiOpenAiTool[]): AgentPiToolCard[] {
    const cardTokens = clampInteger(
      Math.floor(this.limits.toolCatalogTokens / Math.max(1, tools.length)),
      this.limits.minToolCardTokens,
      this.limits.maxToolCardTokens,
    );
    const descriptionTokens = Math.max(1, Math.floor(cardTokens * PiPlanningBudgetPolicy.toolDescriptionRatio));
    const schemaTokens = Math.max(1, cardTokens - descriptionTokens);
    return tools.map((tool) => {
      const stats: ProjectionStatsAccumulator = { truncatedTextFields: 0, truncatedJsonFields: 0 };
      const projected = this.projectToolForPlanning(tool, stats, { descriptionTokens, schemaTokens });
      return {
        name: projected.function.name,
        description: projected.function.description,
        parameters: projected.function.parameters,
      };
    });
  }

  private projectMessages(
    messages: PiOpenAiChatCompletionRequest["messages"],
    stats: ProjectionStatsAccumulator,
  ): {
    items: unknown[];
    omittedOlderMessages: number;
  } {
    const tail = messages.slice(-this.limits.maxMessages);
    return {
      items: tail.map((message) => this.projectMessageForPlanning(message, stats)),
      omittedOlderMessages: messages.length - tail.length,
    };
  }

  private projectMessageForPlanning(
    message: PiOpenAiChatCompletionRequest["messages"][number],
    stats: ProjectionStatsAccumulator,
  ): Record<string, unknown> {
    const role = typeof message.role === "string" ? message.role : "user";
    return compactPiProjection({
      role,
      name: message.name,
      tool_call_id: message.tool_call_id,
      content: this.projectOpenAiContentForPlanning(
        message.content,
        role === "tool" ? this.limits.toolMessageTokens : this.limits.messageTokens,
        stats,
      ),
      tool_calls: message.tool_calls?.map((call) => this.projectToolCallForPlanning(call, stats)),
    });
  }

  private projectOpenAiContentForPlanning(
    content: PiOpenAiChatCompletionRequest["messages"][number]["content"],
    tokenLimit: number,
    stats: ProjectionStatsAccumulator,
  ): unknown {
    if (typeof content === "string") {
      return this.previewTextField(content, tokenLimit, stats);
    }
    if (content === null || content === undefined) {
      return content;
    }
    if (!Array.isArray(content)) {
      return this.projectUnknownForPlanning(content, tokenLimit, stats);
    }
    return content.map((part) => this.projectContentPart(part, stats));
  }

  private projectContentPart(
    part: NonNullable<PiOpenAiChatCompletionRequest["messages"][number]["content"]>[number],
    stats: ProjectionStatsAccumulator,
  ): unknown {
    if (!part || typeof part !== "object") {
      return part;
    }
    return Object.fromEntries(
      Object.entries(part).flatMap(([key, value]) => {
        const projected =
          key === "text" && typeof value === "string"
            ? this.previewTextField(value, this.limits.textPartTokens, stats)
            : this.projectUnknownForPlanning(value, this.limits.jsonTokens, stats);
        return projected === undefined ? [] : [[key, projected]];
      }),
    );
  }

  private projectToolCallForPlanning(
    call: NonNullable<PiOpenAiChatCompletionRequest["messages"][number]["tool_calls"]>[number],
    stats: ProjectionStatsAccumulator,
  ): Record<string, unknown> {
    return compactPiProjection({
      id: call.id,
      type: call.type,
      function: {
        name: call.function.name,
        arguments: this.projectUnknownForPlanning(call.function.arguments, this.limits.jsonTokens, stats),
      },
    });
  }

  private projectToolForPlanning(
    tool: PiOpenAiTool,
    stats: ProjectionStatsAccumulator,
    limits: { descriptionTokens: number; schemaTokens: number },
  ): PiOpenAiTool {
    return {
      ...tool,
      function: {
        ...tool.function,
        description: tool.function.description
          ? this.previewTextField(tool.function.description, limits.descriptionTokens, stats)
          : undefined,
        parameters: this.projectUnknownForPlanning(tool.function.parameters, limits.schemaTokens, stats) as
          Record<string, unknown> | undefined,
      },
    };
  }

  private projectUnknownForPlanning(value: unknown, tokenLimit: number, stats: ProjectionStatsAccumulator): unknown {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof value === "string") {
      return this.previewTextField(value, tokenLimit, stats);
    }
    const projected = this.tokenProjector.previewJson(value, tokenLimit);
    if (projected !== value) {
      stats.truncatedJsonFields += 1;
    }
    return projected;
  }

  private buildToolTranscript(
    messages: PiOpenAiChatCompletionRequest["messages"],
    stats: ProjectionStatsAccumulator,
  ): AgentPiToolTranscriptItem[] {
    const calls = new Map<string, AgentPiToolTranscriptItem>();
    for (const message of messages) {
      for (const call of message.tool_calls ?? []) {
        const id = call.id?.trim();
        if (!id) {
          continue;
        }
        calls.set(id, {
          callId: id,
          toolName: call.function.name,
          argumentsJson: this.projectToolArgumentsJson(call.function.arguments, stats),
        });
      }

      if (message.role !== "tool" || !message.tool_call_id) {
        continue;
      }

      const text = readOpenAiContentAsText(message.content);
      const current = calls.get(message.tool_call_id) ?? {
        callId: message.tool_call_id,
        toolName: "",
        argumentsJson: "{}",
      };
      calls.set(message.tool_call_id, {
        ...current,
        observation: this.projectToolObservationSummary(text, stats),
      });
    }

    return [...calls.values()].filter((entry) => entry.callId.trim().length > 0);
  }

  private projectToolArgumentsJson(value: unknown, stats: ProjectionStatsAccumulator): string {
    const canonical = canonicalizeToolArguments(value);
    const projected = this.previewTextField(canonical, this.limits.jsonTokens, stats);
    return typeof projected === "string" ? projected : JSON.stringify(projected);
  }

  private projectToolObservationSummary(
    content: string,
    stats: ProjectionStatsAccumulator,
  ): NonNullable<AgentPiToolTranscriptItem["observation"]> {
    const parsed = readRecordFromJson(content);
    return {
      status: readToolObservationStatus(parsed),
      summary:
        typeof parsed?.summary === "string"
          ? this.previewTextField(parsed.summary, this.limits.toolMessageTokens, stats)
          : undefined,
      artifactUri: readString(parsed?.artifact_uri ?? parsed?.artifactUri),
      evidenceUris: readEvidenceUris(parsed),
    };
  }

  private previewTextField(value: string, tokenLimit: number, stats: ProjectionStatsAccumulator): string {
    const preview = this.tokenProjector.previewText(value, tokenLimit);
    if (preview.truncated) {
      stats.truncatedTextFields += 1;
    }
    return preview.text;
  }
}

export function resolveAgentPiOpenAiPlanningProjectionLimits(
  provider: Pick<ResolvedAgentModelProviderConfig, "ContextWindowTokens" | "MaxOutputTokens">,
): AgentPiOpenAiPlanningProjectionLimits {
  const contextWindowTokens =
    positiveInteger(provider.ContextWindowTokens) ?? PiPlanningBudgetPolicy.unknownContextWindowTokens;
  const outputReserveTokens =
    positiveInteger(provider.MaxOutputTokens) ?? PiPlanningBudgetPolicy.defaultOutputReserveTokens;
  const usableInputTokens = Math.max(
    PiPlanningBudgetPolicy.minProjectedMessages * PiPlanningBudgetPolicy.messagesPerTokenChunk,
    contextWindowTokens - outputReserveTokens,
  );
  const planningInputTokenBudget = Math.floor(usableInputTokens * PiPlanningBudgetPolicy.inputBudgetRatio);
  return {
    planningInputTokenBudget,
    maxMessages: clampInteger(
      Math.floor(planningInputTokenBudget / PiPlanningBudgetPolicy.messagesPerTokenChunk),
      PiPlanningBudgetPolicy.minProjectedMessages,
      PiPlanningBudgetPolicy.maxProjectedMessages,
    ),
    messageTokens: clampInteger(
      Math.floor(planningInputTokenBudget / 8),
      PiPlanningBudgetPolicy.minMessageTokens,
      PiPlanningBudgetPolicy.maxMessageTokens,
    ),
    toolMessageTokens: clampInteger(
      Math.floor(planningInputTokenBudget / 16),
      PiPlanningBudgetPolicy.minToolMessageTokens,
      PiPlanningBudgetPolicy.maxToolMessageTokens,
    ),
    textPartTokens: clampInteger(
      Math.floor(planningInputTokenBudget / 24),
      PiPlanningBudgetPolicy.minToolMessageTokens,
      PiPlanningBudgetPolicy.maxToolMessageTokens,
    ),
    jsonTokens: clampInteger(
      Math.floor(planningInputTokenBudget / 16),
      PiPlanningBudgetPolicy.minJsonTokens,
      PiPlanningBudgetPolicy.maxJsonTokens,
    ),
    toolCatalogTokens: clampInteger(
      Math.floor(planningInputTokenBudget / 4),
      PiPlanningBudgetPolicy.minToolCatalogTokens,
      PiPlanningBudgetPolicy.maxToolCatalogTokens,
    ),
    minToolCardTokens: PiPlanningBudgetPolicy.minToolCardTokens,
    maxToolCardTokens: PiPlanningBudgetPolicy.maxToolCardTokens,
  };
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readOpenAiContentAsText(content: PiOpenAiChatCompletionRequest["messages"][number]["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("");
}

function canonicalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    const parsed = readJson(value);
    return parsed === undefined ? value : stableStringify(parsed);
  }
  return stableStringify(value ?? {});
}

function readJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readToolObservationStatus(
  value: Record<string, unknown> | undefined,
): NonNullable<AgentPiToolTranscriptItem["observation"]>["status"] {
  switch (value?.status) {
    case "success":
    case "failure":
    case "empty":
      return value.status;
    default:
      return "unknown";
  }
}

function readEvidenceUris(value: Record<string, unknown> | undefined): string[] {
  if (!value) {
    return [];
  }
  return uniqueStrings([
    ...readStringArray(value.evidence_uris ?? value.evidenceUris),
    ...readArray(value.evidence).flatMap(
      (entry) => readString(readRecord(entry)?.evidence_uri ?? readRecord(entry)?.evidenceUri) ?? [],
    ),
  ]);
}

function readRecordFromJson(value: string): Record<string, unknown> | undefined {
  const parsed = readJson(value);
  return readRecord(parsed);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = readString(entry);
        return text ? [text] : [];
      })
    : [];
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compactPiProjection<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== "" && !(Array.isArray(entry) && entry.length === 0),
    ),
  );
}
