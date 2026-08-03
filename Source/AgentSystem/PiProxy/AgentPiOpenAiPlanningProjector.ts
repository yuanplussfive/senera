import { parseJsonTextOrUndefined } from "../Core/AgentJsonParsing.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { compactRecord, readArrayValue, readStringArray, uniqueStrings } from "../Core/AgentCollections.js";
import { readAgentNonBlankString, readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentPiAssistantMessageCompileInput,
  AgentPiToolRoutingCard,
  AgentPiToolTranscriptItem,
} from "../PiShared/AgentPiPlanningTypes.js";
import {
  assertAgentPiToolObservationBounded,
  readAgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
import type { PiOpenAiChatCompletionRequest, PiOpenAiTool } from "./AgentPiOpenAiWireTypes.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import type { AgentPromptContractProperty } from "../Prompt/AgentPromptContractTypes.js";
import { readAgentPiToolObservationStatus } from "../PiShared/AgentPiToolObservationStatus.js";
import { readAgentToolOutputAvailability } from "../ToolRuntime/AgentToolResultOutcome.js";
import { compactionSummaryOpen, compactionSummaryClose } from "../PiShared/AgentPiCompactionTags.js";

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
  hasCompactionBoundary: boolean;
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
} as const;

const ToolRoutingCardSections = ["summary", "inputs", "outputs", "effects"] as const;

/**
 * Markers used to detect compaction summary messages in the Pi request stream.
 * Senera-side markers come from {@link AgentPiCompactionTags}; the Pi-native
 * `<summary>` markers are external protocol constants from the upstream Pi
 * coding agent and are declared here as named constants rather than inline
 * string literals.
 */
const PiNativeCompactionTags = {
  summaryOpen: "<summary>",
  summaryClose: "</summary>",
} as const;

const CompactionSummaryMarkers = {
  seneraBegin: compactionSummaryOpen,
  seneraEnd: compactionSummaryClose,
  piSummaryOpen: PiNativeCompactionTags.summaryOpen,
  piSummaryClose: PiNativeCompactionTags.summaryClose,
} as const;

export class AgentPiOpenAiPlanningProjector {
  private readonly limits: AgentPiOpenAiPlanningProjectionLimits;
  private readonly tokenProjector: AgentTokenProjector;
  private readonly toolContracts = new AgentJsonSchemaPromptContractProjector();

  constructor(options: AgentPiOpenAiPlanningProjectorOptions) {
    this.limits = resolveAgentPiOpenAiPlanningProjectionLimits(options.modelProvider);
    this.tokenProjector = new AgentTokenProjector(options.modelProvider.Model);
  }

  project(request: PiOpenAiChatCompletionRequest): AgentPiAssistantMessageCompileInput["openAiRequest"] {
    assertBoundedToolObservations(request.messages);
    const stats: ProjectionStatsAccumulator = {
      truncatedTextFields: 0,
      truncatedJsonFields: 0,
    };
    const messages = this.projectMessages(request.messages, stats);
    const compactionBoundaryIndex = findCompactionSummaryMessageIndex(request.messages);
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
        hasCompactionBoundary: compactionBoundaryIndex !== -1,
      },
    };
  }

  detectCompactionSummaryText(messages: PiOpenAiChatCompletionRequest["messages"]): string | undefined {
    const index = findCompactionSummaryMessageIndex(messages);
    if (index === -1) return undefined;
    const content = readOpenAiContentAsText(messages[index]?.content);
    return content.trim().length > 0 ? content : undefined;
  }

  projectToolCards(tools: readonly PiOpenAiTool[]): AgentPiToolRoutingCard[] {
    const cardTokens = clampInteger(
      Math.floor(this.limits.toolCatalogTokens / Math.max(1, tools.length)),
      this.limits.minToolCardTokens,
      this.limits.maxToolCardTokens,
    );
    const summaryTokens = Math.max(1, Math.floor(cardTokens / ToolRoutingCardSections.length));
    return tools.map((tool) => {
      const stats: ProjectionStatsAccumulator = { truncatedTextFields: 0, truncatedJsonFields: 0 };
      return {
        name: tool.function.name,
        summary: tool.function.description
          ? this.previewTextField(tool.function.description, summaryTokens, stats)
          : "",
        inputs: this.projectToolInputs(tool.function.parameters),
        outputs: [],
        effects: [],
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
    const complete = messages.map((message) => this.projectMessageWithoutTruncation(message));
    if (this.tokenProjector.countJson(complete) <= this.limits.planningInputTokenBudget) {
      return {
        items: complete,
        omittedOlderMessages: 0,
      };
    }

    const compactionIndex = findCompactionSummaryMessageIndex(messages);
    const tailStart = Math.max(0, messages.length - this.limits.maxMessages);
    const preservedIndices = new Set<number>();

    if (compactionIndex !== -1 && compactionIndex < tailStart) {
      preservedIndices.add(compactionIndex);
    }

    const tail = messages.filter((_, index) => index >= tailStart || preservedIndices.has(index));
    const omitted = messages.length - tail.length;
    return {
      items: tail.map((message) => this.projectMessageForPlanning(message, stats)),
      omittedOlderMessages: omitted,
    };
  }

  private projectMessageWithoutTruncation(
    message: PiOpenAiChatCompletionRequest["messages"][number],
  ): Record<string, unknown> {
    return compactRecord({
      role: typeof message.role === "string" ? message.role : "user",
      name: message.name,
      tool_call_id: message.tool_call_id,
      content: message.content,
      tool_calls: message.tool_calls?.map((call) =>
        compactRecord({
          id: call.id,
          type: call.type,
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        }),
      ),
    });
  }

  private projectMessageForPlanning(
    message: PiOpenAiChatCompletionRequest["messages"][number],
    stats: ProjectionStatsAccumulator,
  ): Record<string, unknown> {
    const role = typeof message.role === "string" ? message.role : "user";
    return compactRecord({
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
    return compactRecord({
      id: call.id,
      type: call.type,
      function: {
        name: call.function.name,
        arguments: this.projectUnknownForPlanning(call.function.arguments, this.limits.jsonTokens, stats),
      },
    });
  }

  private projectToolInputs(schema: unknown): string[] {
    const contract = this.toolContracts.project(normalizeJsonSchema(schema));
    return contract.properties.flatMap(projectRoutingInputs);
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
    const detail = readAgentUnknownRecord(parsed?.detail);
    const error = readAgentUnknownRecord(parsed?.error ?? detail?.error_detail);
    const summary = readAgentNonBlankString(detail?.semantic_digest ?? detail?.summary ?? detail?.headline);
    return {
      status: readAgentPiToolObservationStatus(parsed?.status),
      outputAvailability: readAgentToolOutputAvailability(parsed?.output_availability),
      summary: summary ? this.previewTextField(summary, this.limits.toolMessageTokens, stats) : undefined,
      artifactUri: readAgentNonBlankString(parsed?.artifact_uri),
      evidenceUris: readEvidenceUris(detail),
      error: error
        ? {
            code: readAgentNonBlankString(error.code),
            kind: readAgentNonBlankString(error.kind),
            source: readAgentNonBlankString(error.source),
            retryable: typeof error.retryable === "boolean" ? error.retryable : undefined,
            message: readAgentNonBlankString(error.message),
          }
        : undefined,
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
  const contextWindowTokens = provider.ContextWindowTokens;
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

function assertBoundedToolObservations(messages: PiOpenAiChatCompletionRequest["messages"]): void {
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const observation = readAgentPiToolObservation(readOpenAiContentAsText(message.content));
    if (observation) assertAgentPiToolObservationBounded(observation);
  }
}

function findCompactionSummaryMessageIndex(messages: PiOpenAiChatCompletionRequest["messages"]): number {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const text = readOpenAiContentAsText(message.content);
    if (text.includes(CompactionSummaryMarkers.seneraBegin) || text.includes(CompactionSummaryMarkers.piSummaryOpen)) {
      return i;
    }
  }
  return -1;
}

function canonicalizeToolArguments(value: unknown): string {
  if (typeof value === "string") {
    const parsed = parseJsonTextOrUndefined(value);
    return parsed === undefined ? value : stringifyAgentCanonicalJson(parsed);
  }
  return stringifyAgentCanonicalJson(value ?? {});
}

function readEvidenceUris(value: Record<string, unknown> | undefined): string[] {
  if (!value) {
    return [];
  }
  return uniqueStrings([
    ...readStringArray(value.evidence_uris ?? value.evidenceUris, { rejectBlank: true }),
    ...readArrayValue(value.evidence).flatMap(
      (entry) =>
        readAgentNonBlankString(
          readAgentUnknownRecord(entry)?.evidence_uri ?? readAgentUnknownRecord(entry)?.evidenceUri,
        ) ?? [],
    ),
  ]);
}

function readRecordFromJson(value: string): Record<string, unknown> | undefined {
  const parsed = parseJsonTextOrUndefined(value);
  return readAgentUnknownRecord(parsed);
}

function normalizeJsonSchema(value: unknown): Record<string, unknown> {
  return readAgentUnknownRecord(value) ?? { type: "object", properties: {} };
}

function projectRoutingInputs(property: AgentPromptContractProperty): string[] {
  const label = `${property.path}: ${property.typeText}${property.required ? " (required)" : ""}`;
  return [
    label,
    ...property.children.flatMap(projectRoutingInputs),
    ...(property.element?.children ?? []).flatMap(projectRoutingInputs),
  ];
}
