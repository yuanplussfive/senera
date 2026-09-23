import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentPiCompactionPromptInput } from "../PiShared/AgentPiCompactionPrompt.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { DefaultAgentPiCompactionProjectionPolicy } from "./AgentPiCompactionProjectionPolicy.js";

export const AgentPiCompactionSummarySources = Object.freeze({
  model: "model",
  deterministicRecovery: "deterministic-recovery",
} as const);
export type AgentPiCompactionSummarySource =
  (typeof AgentPiCompactionSummarySources)[keyof typeof AgentPiCompactionSummarySources];

export interface AgentPiDeterministicCompactionRecoveryOptions {
  readonly model: string;
  readonly reason: "threshold" | "overflow" | "mid_turn";
}

/**
 * Builds a bounded checkpoint without another provider request. This is only
 * used when automatic compaction cannot obtain a model summary. The complete
 * transcript remains append-only; this text is just the new model-facing
 * boundary and the indexes keep the durable references addressable.
 */
export function createAgentPiDeterministicCompactionSummary(
  input: AgentPiCompactionPromptInput,
  options: AgentPiDeterministicCompactionRecoveryOptions,
): string {
  const projector = new AgentTokenProjector(options.model);
  const policy = DefaultAgentPiCompactionProjectionPolicy;
  const sections = [
    "Deterministic compaction checkpoint",
    `source=runtime-recovery reason=${options.reason}`,
    "The provider summarizer was unavailable. The append-only session history remains authoritative; use the artifact, tool-call, and continuity indexes below to recover omitted details.",
  ];

  const indexSummary = projectRecoveryIndexes(input);
  if (indexSummary) sections.push(indexSummary);

  const previousSummary = boundedText(projector, input.previousSummary, policy.recoveryPreviousSummaryTokenBudget);
  if (previousSummary) sections.push(`Previous checkpoint:\n${previousSummary}`);

  const recentMessages = input.messages
    .slice(-policy.recoveryRecentMessageCount)
    .map((message) => projectRecoveryMessage(message, projector, policy.recoveryMessageTokenBudget))
    .filter((message): message is string => message !== undefined);
  if (recentMessages.length > 0) sections.push(`Recent visible messages:\n${recentMessages.join("\n")}`);

  const summaryText = sections.join("\n\n");
  return projector.previewText(summaryText, policy.maxSummaryTokens).text || sections[0];
}

function projectRecoveryMessage(
  message: AgentMessage,
  projector: AgentTokenProjector,
  tokenBudget: number,
): string | undefined {
  const label = message.role;
  const text = readRecoverableText(message);
  if (!text) {
    if (message.role === "toolResult") return `[${label}] observation retained in the tool/artifact index`;
    return undefined;
  }
  return `[${label}] ${projector.previewText(text, tokenBudget).text}`;
}

function readRecoverableText(message: AgentMessage): string {
  switch (message.role) {
    case "user":
      return readContentText(message.content);
    case "assistant":
      return readContentText(message.content);
    case "toolResult":
      return "";
    case "compactionSummary":
      return message.summary;
    case "branchSummary":
      return message.summary;
    case "bashExecution":
      return [message.command, message.output].filter((value) => value.trim().length > 0).join("\n");
    case "custom":
      return readContentText(message.content);
    default:
      return "";
  }
}

function readContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { type?: unknown; text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("")
    .trim();
}

function boundedText(projector: AgentTokenProjector, value: string | undefined, tokenBudget: number): string {
  if (!value?.trim()) return "";
  return projector.previewText(value.trim(), tokenBudget).text;
}

function projectRecoveryIndexes(input: AgentPiCompactionPromptInput): string | undefined {
  const artifactCount = readArrayLength(input.artifactIndex, "artifacts");
  const ledgerReferences = readArrayLength(input.continuityLedger, "references");
  const ledgerCheckpoints = readArrayLength(input.continuityLedger, "checkpoints");
  const toolCalls = readArrayLength(input.toolCallIndex, "calls");
  const values = [
    artifactCount === undefined ? undefined : `artifacts=${artifactCount}`,
    toolCalls === undefined ? undefined : `toolCalls=${toolCalls}`,
    ledgerReferences === undefined ? undefined : `continuityReferences=${ledgerReferences}`,
    ledgerCheckpoints === undefined ? undefined : `checkpoints=${ledgerCheckpoints}`,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0 ? `Durable indexes: ${values.join(" ")}` : undefined;
}

function readArrayLength(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.length : undefined;
}
