import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import type { AgentPromptContractProperty } from "../Prompt/AgentPromptContractTypes.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentPiModelMaxTokens } from "./AgentPiModelProjector.js";
import type {
  AgentPiAssistantMessageCompileInput,
  AgentPiToolContract,
  AgentPiToolRoutingCard,
  AgentPiToolTranscriptItem,
} from "../PiShared/AgentPiPlanningTypes.js";
import { readAgentPiToolObservationStatus } from "../PiShared/AgentPiToolObservationStatus.js";
import { readAgentToolOutputAvailability } from "../ToolRuntime/AgentToolResultOutcome.js";
import { compactionSummaryOpen } from "../PiShared/AgentPiCompactionTags.js";
import {
  assertAgentPiToolObservationBounded,
  AgentPiToolObservationProtocolError,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
  readAgentPiToolObservationArtifactUri,
} from "./AgentPiToolObservation.js";

export interface AgentPiPlanningContextCompilerOptions {
  modelProvider: Pick<
    ResolvedAgentModelProviderConfig,
    "ContextWindowTokens" | "MaxModelOutputTokens" | "MaxOutputTokens" | "Model"
  >;
}

export interface AgentPiPlanningContextCompileInput {
  readonly model: string;
  readonly context: Context;
  readonly maxTokens?: number;
  readonly reservedTokens?: number;
  readonly toolExecution?: "parallel" | "sequential";
}

export interface AgentPiPlanningContextCompilation {
  readonly planningContext: AgentPiAssistantMessageCompileInput["planningContext"];
  readonly routingCards: AgentPiToolRoutingCard[];
  readonly toolContracts: ReadonlyMap<string, AgentPiToolContract>;
}

interface AgentPiProjectedMessage {
  readonly index: number;
  readonly source: Message;
  readonly projected: unknown;
}

interface AgentPiMessageSelection {
  readonly items: unknown[];
  readonly toolTranscript: AgentPiToolTranscriptItem[];
  readonly omittedOlderMessages: number;
}

const PiNativeCompactionSummaryOpen = "<summary>";

/**
 * Compiles Pi's native model context into the transport-neutral BAML planning
 * contract. It switches on Pi message roles and Senera protocol markers; it
 * never infers semantics from arbitrary payload field names.
 */
export class AgentPiPlanningContextCompiler {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly toolContracts = new AgentJsonSchemaPromptContractProjector();
  private readonly inputTokenCapacity: number;

  constructor(options: AgentPiPlanningContextCompilerOptions) {
    this.tokenProjector = new AgentTokenProjector(options.modelProvider.Model);
    this.inputTokenCapacity = Math.max(
      1,
      Math.floor(options.modelProvider.ContextWindowTokens) - resolveAgentPiModelMaxTokens(options.modelProvider),
    );
  }

  compile(input: AgentPiPlanningContextCompileInput): AgentPiPlanningContextCompilation {
    const tools = input.context.tools ?? [];
    const routingCards = tools.map((tool) => this.projectToolCard(tool));
    const toolContracts = new Map(tools.map((tool) => [tool.name, authoritativeToolContract(tool)]));
    const projectedMessages = input.context.messages.map<AgentPiProjectedMessage>((source, index) => ({
      index,
      source,
      projected: projectMessage(source),
    }));
    const structuralTokens = this.tokenProjector.countJson({
      model: input.model,
      systemPrompt: input.context.systemPrompt || undefined,
      routingCards,
      toolExecution: input.toolExecution ?? "parallel",
      maxTokens: input.maxTokens,
    });
    const messageBudget = Math.max(
      1,
      this.inputTokenCapacity - normalizeTokenCount(input.reservedTokens) - structuralTokens,
    );
    const messages = this.selectMessages(projectedMessages, messageBudget);
    const compactionBoundaryIndex = findCompactionSummaryMessageIndex(input.context.messages);
    const originalToolCallCount = countToolCalls(input.context.messages);

    return {
      planningContext: {
        model: input.model,
        systemPrompt: input.context.systemPrompt || undefined,
        messages: messages.items,
        toolTranscript: messages.toolTranscript,
        toolExecution: input.toolExecution ?? "parallel",
        maxTokens: input.maxTokens,
        projection: {
          originalMessageCount: input.context.messages.length,
          projectedMessageCount: messages.items.length,
          omittedOlderMessages: messages.omittedOlderMessages,
          originalToolCallCount,
          projectedToolCallCount: messages.toolTranscript.length,
          omittedOlderToolCalls: Math.max(0, originalToolCallCount - messages.toolTranscript.length),
          planningInputTokenBudget: messageBudget,
          hasCompactionBoundary: compactionBoundaryIndex !== -1,
        },
      },
      routingCards,
      toolContracts,
    };
  }

  detectCompactionSummaryText(messages: readonly Message[]): string | undefined {
    const index = findCompactionSummaryMessageIndex(messages);
    if (index === -1) return undefined;
    const text = readMessageText(messages[index]);
    return text.trim().length > 0 ? text : undefined;
  }

  private projectToolCard(tool: Tool): AgentPiToolRoutingCard {
    const contract = this.toolContracts.project(normalizeJsonSchema(tool.parameters));
    return {
      name: tool.name,
      summary: tool.description,
      inputs: contract.properties.flatMap(projectRoutingInputs),
      outputs: [],
      effects: [],
    };
  }

  private selectMessages(messages: readonly AgentPiProjectedMessage[], tokenBudget: number): AgentPiMessageSelection {
    const completeTranscript = buildToolTranscript(messages.map((message) => message.source));
    const completeProjection = messages.map((message) => message.projected);
    if (this.fitsSelection(completeProjection, completeTranscript, tokenBudget)) {
      return { items: completeProjection, toolTranscript: completeTranscript, omittedOlderMessages: 0 };
    }

    const boundaryIndex = findProjectedCompactionBoundary(completeProjection);
    const turns = groupProjectedTurns(messages);
    let lower = 0;
    let upper = turns.length;
    let selected: AgentPiProjectedMessage[] = [];
    while (lower <= upper) {
      const suffixTurns = Math.floor((lower + upper) / 2);
      const candidate = selectTurnSuffix(turns, suffixTurns, messages, boundaryIndex);
      const projected = candidate.map((message) => message.projected);
      const transcript = buildToolTranscript(candidate.map((message) => message.source));
      if (this.fitsSelection(projected, transcript, tokenBudget)) {
        selected = candidate;
        lower = suffixTurns + 1;
      } else {
        upper = suffixTurns - 1;
      }
    }

    const latestMessage = messages.at(-1);
    if (latestMessage && !selected.some((message) => message.index === latestMessage.index)) {
      throw new Error("The current Pi conversation turn exceeds the Senera planning input budget.");
    }
    const toolTranscript = buildToolTranscript(selected.map((message) => message.source));
    return {
      items: selected.map((message) => message.projected),
      toolTranscript,
      omittedOlderMessages: Math.max(0, messages.length - selected.length),
    };
  }

  private fitsSelection(
    messages: readonly unknown[],
    toolTranscript: readonly AgentPiToolTranscriptItem[],
    tokenBudget: number,
  ): boolean {
    return this.tokenProjector.fitsJson({ messages, toolTranscript }, tokenBudget);
  }
}

function groupProjectedTurns(messages: readonly AgentPiProjectedMessage[]): AgentPiProjectedMessage[][] {
  const turns: AgentPiProjectedMessage[][] = [];
  for (const message of messages) {
    if (message.source.role === "user" || turns.length === 0) turns.push([]);
    turns.at(-1)?.push(message);
  }
  return turns;
}

function selectTurnSuffix(
  turns: readonly AgentPiProjectedMessage[][],
  suffixTurns: number,
  messages: readonly AgentPiProjectedMessage[],
  boundaryIndex: number,
): AgentPiProjectedMessage[] {
  const selected = turns.slice(Math.max(0, turns.length - suffixTurns)).flat();
  const boundary = boundaryIndex >= 0 ? messages[boundaryIndex] : undefined;
  const byIndex = new Map(selected.map((message) => [message.index, message]));
  if (boundary) byIndex.set(boundary.index, boundary);
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

function countToolCalls(messages: readonly Message[]): number {
  return messages.reduce(
    (count, message) =>
      message.role === "assistant" ? count + message.content.filter((part) => part.type === "toolCall").length : count,
    0,
  );
}

function projectMessage(message: Message): unknown {
  switch (message.role) {
    case "user":
      return { role: "user", content: projectUserContent(message.content) };
    case "assistant":
      return {
        role: "assistant",
        content: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        toolCalls: message.content.flatMap((part) =>
          part.type === "toolCall" ? [{ id: part.id, name: part.name, arguments: part.arguments }] : [],
        ),
      };
    case "toolResult": {
      const observation = readToolObservation(message);
      return {
        role: "tool",
        callId: message.toolCallId,
        toolName: message.toolName,
        observation,
      };
    }
  }
}

function projectUserContent(content: Extract<Message, { role: "user" }>["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", mimeType: part.mimeType, encodedBytes: part.data.length },
  );
}

function readToolObservation(message: Extract<Message, { role: "toolResult" }>): AgentPiToolObservation {
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  const observation = readAgentPiToolObservation(text);
  if (!observation) throw new AgentPiToolObservationProtocolError();
  assertAgentPiToolObservationBounded(observation);
  return observation;
}

function buildToolTranscript(messages: readonly Message[]): AgentPiToolTranscriptItem[] {
  const calls = new Map<string, AgentPiToolTranscriptItem>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        calls.set(part.id, {
          callId: part.id,
          toolName: part.name,
          argumentsJson: JSON.stringify(part.arguments),
        });
      }
      continue;
    }
    if (message.role !== "toolResult") continue;
    const observation = readToolObservation(message);
    const current = calls.get(message.toolCallId) ?? {
      callId: message.toolCallId,
      toolName: message.toolName,
      argumentsJson: "{}",
    };
    const detail = observation.detail;
    const error = observation.error;
    calls.set(message.toolCallId, {
      ...current,
      observation: {
        status: readAgentPiToolObservationStatus(observation.status),
        outputAvailability: readAgentToolOutputAvailability(observation.output_availability),
        summary:
          typeof detail.semantic_digest === "string"
            ? detail.semantic_digest
            : typeof detail.summary === "string"
              ? detail.summary
              : undefined,
        artifactUri: readAgentPiToolObservationArtifactUri(observation),
        evidenceUris: detail.evidence.flatMap((entry) => (entry.evidence_uri ? [entry.evidence_uri] : [])),
        error: error
          ? {
              code: error.code,
              kind: error.kind,
              source: error.source,
              retryable: error.retryable,
              message: error.message,
            }
          : undefined,
      },
    });
  }
  return [...calls.values()];
}

function authoritativeToolContract(tool: Tool): AgentPiToolContract {
  return Object.freeze({
    name: tool.name,
    description: tool.description,
    parameters: structuredClone(tool.parameters),
  });
}

function normalizeJsonSchema(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { type: "object", properties: {} };
}

function projectRoutingInputs(property: AgentPromptContractProperty): string[] {
  const label = `${property.path}: ${property.typeText}${property.required ? " (required)" : ""}`;
  return [
    label,
    ...property.children.flatMap(projectRoutingInputs),
    ...(property.element?.children ?? []).flatMap(projectRoutingInputs),
  ];
}

function findCompactionSummaryMessageIndex(messages: readonly Message[]): number {
  return messages.findIndex(
    (message) =>
      message.role === "user" &&
      (readMessageText(message).includes(compactionSummaryOpen) ||
        readMessageText(message).includes(PiNativeCompactionSummaryOpen)),
  );
}

function findProjectedCompactionBoundary(messages: readonly unknown[]): number {
  return messages.findIndex((message) => {
    const text = JSON.stringify(message);
    return text.includes(compactionSummaryOpen) || text.includes(PiNativeCompactionSummaryOpen);
  });
}

function readMessageText(message: Message | undefined): string {
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function normalizeTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
