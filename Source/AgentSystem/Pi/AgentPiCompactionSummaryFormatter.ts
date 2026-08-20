import type { AgentPiCompactionToolCallEntry, AgentPiCompactionToolCallIndex } from "./AgentPiCompactionToolIndex.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { formatXmlBlock } from "../Xml/AgentXmlFormat.js";
import { AgentCompactionSummaryTags } from "./AgentPiCompactionTags.js";
import {
  DefaultAgentPiCompactionProjectionPolicy,
  normalizeAgentPiCompactionLimit,
} from "./AgentPiCompactionProjectionPolicy.js";

export interface AgentPiCompactionSummaryFormatterOptions {
  readonly model: string;
  readonly maxSummaryTokens: number;
  readonly maxToolIndexTokens: number;
  readonly maxDisplayedCalls: number;
}

export interface AgentPiCompactionSummaryFormatterInput {
  readonly summaryText: string;
  readonly toolCallIndex?: AgentPiCompactionToolCallIndex;
}

export interface AgentPiCompactionSummaryFormattedText {
  readonly text: string;
  readonly summaryTokens: number;
  readonly toolIndexTokens: number;
  readonly displayedCalls: number;
  readonly truncated: boolean;
}

export const DefaultAgentPiCompactionSummaryFormatterOptions: Readonly<AgentPiCompactionSummaryFormatterOptions> =
  Object.freeze({
    model: "default",
    maxSummaryTokens: DefaultAgentPiCompactionProjectionPolicy.maxSummaryTokens,
    maxToolIndexTokens: DefaultAgentPiCompactionProjectionPolicy.maxToolIndexTokens,
    maxDisplayedCalls: DefaultAgentPiCompactionProjectionPolicy.maxDisplayedCalls,
  });

const CompactionSummarySectionTitles = {
  summary: "Conversation Summary",
  toolIndexStats: "Tool Call Statistics",
  toolIndexRecent: "Recent Tool Calls",
} as const;

const StatusLabels: Readonly<Record<AgentPiCompactionToolCallEntry["status"], string>> = Object.freeze({
  success: "SUCCESS",
  failure: "FAILURE",
  empty: "EMPTY",
});

const NewLine = "\n";
const SectionSeparator = NewLine + NewLine;

export class AgentPiCompactionSummaryFormatter {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly options: AgentPiCompactionSummaryFormatterOptions;

  constructor(options: AgentPiCompactionSummaryFormatterOptions = DefaultAgentPiCompactionSummaryFormatterOptions) {
    const model = options.model.trim();
    if (!model) throw new RangeError("model must be non-blank.");
    this.options = {
      model,
      maxSummaryTokens: normalizeAgentPiCompactionLimit(options.maxSummaryTokens, "maxSummaryTokens"),
      maxToolIndexTokens: normalizeAgentPiCompactionLimit(options.maxToolIndexTokens, "maxToolIndexTokens"),
      maxDisplayedCalls: normalizeAgentPiCompactionLimit(options.maxDisplayedCalls, "maxDisplayedCalls"),
    };
    this.tokenProjector = new AgentTokenProjector(model);
  }

  format(input: AgentPiCompactionSummaryFormatterInput): AgentPiCompactionSummaryFormattedText {
    const summarySection = this.formatSummarySection(input.summaryText);
    const toolIndexSection = input.toolCallIndex
      ? this.formatToolIndexSection(input.toolCallIndex)
      : { text: "", tokens: 0, displayedCalls: 0, truncated: false };

    const text = [summarySection.text, toolIndexSection.text]
      .filter((segment) => segment.length > 0)
      .join(SectionSeparator);

    return {
      text,
      summaryTokens: summarySection.tokens,
      toolIndexTokens: toolIndexSection.tokens,
      displayedCalls: toolIndexSection.displayedCalls,
      truncated: summarySection.truncated || toolIndexSection.truncated,
    };
  }

  private formatSummarySection(summaryText: string): {
    text: string;
    tokens: number;
    truncated: boolean;
  } {
    const trimmed = summaryText.trim();
    if (trimmed.length === 0) return { text: "", tokens: 0, truncated: false };

    const preview = this.tokenProjector.previewText(trimmed, this.options.maxSummaryTokens);
    const body = formatXmlBlock(AgentCompactionSummaryTags.summary, [], preview.text);
    return {
      text: body,
      tokens: preview.tokenCount,
      truncated: preview.truncated,
    };
  }

  private formatToolIndexSection(index: AgentPiCompactionToolCallIndex): {
    text: string;
    tokens: number;
    displayedCalls: number;
    truncated: boolean;
  } {
    if (index.calls.length === 0) return { text: "", tokens: 0, displayedCalls: 0, truncated: false };

    const statsLine = formatToolIndexStats(index);
    const displayableCalls = index.calls.slice(-this.options.maxDisplayedCalls);
    const omittedCalls = index.calls.length - displayableCalls.length;

    const callLines = displayableCalls.map((entry, position) => formatToolCallEntry(entry, position + 1));
    const sections: string[] = [statsLine];

    if (omittedCalls > 0) {
      sections.push(`(${omittedCalls} older call${omittedCalls > 1 ? "s" : ""} omitted)`);
    }

    sections.push(callLines.join(NewLine));

    const innerContent = [
      [CompactionSummarySectionTitles.toolIndexStats, statsLine].join(NewLine),
      [CompactionSummarySectionTitles.toolIndexRecent, ...sections.slice(1)].join(NewLine),
    ].join(NewLine);

    const fullText = formatXmlBlock(AgentCompactionSummaryTags.toolIndex, [], innerContent);

    const preview = this.tokenProjector.previewText(fullText, this.options.maxToolIndexTokens);
    return {
      text: preview.text,
      tokens: preview.tokenCount,
      displayedCalls: displayableCalls.length,
      truncated: preview.truncated,
    };
  }
}

function formatToolIndexStats(index: AgentPiCompactionToolCallIndex): string {
  const parts = [
    `Total: ${index.totalCalls}`,
    `Success: ${index.successCount}`,
    `Failure: ${index.failureCount}`,
    `Empty: ${index.emptyCount}`,
  ];
  if (index.artifactUris.length > 0) parts.push(`Artifacts: ${index.artifactUris.length}`);
  if (index.evidenceUris.length > 0) parts.push(`Evidence: ${index.evidenceUris.length}`);
  return parts.join(" | ");
}

function formatToolCallEntry(entry: AgentPiCompactionToolCallEntry, position: number): string {
  const statusLabel = StatusLabels[entry.status];
  const header = `${position}. [${statusLabel}] ${entry.toolName} (${entry.callId})`;

  const lines: string[] = [header];
  if (entry.argumentsPreview.length > 0) {
    lines.push(`   args: ${entry.argumentsPreview}`);
  }
  if (entry.summary) {
    lines.push(`   summary: ${entry.summary}`);
  }
  if (entry.artifactUri) {
    lines.push(`   artifact: ${entry.artifactUri}`);
  }
  if (entry.evidenceUris.length > 0) {
    lines.push(`   evidence: ${entry.evidenceUris.join(", ")}`);
  }
  if (entry.error) {
    lines.push(`   error: ${formatToolCallError(entry.error)}`);
  }

  return lines.join(NewLine);
}

function formatToolCallError(error: AgentPiCompactionToolCallEntry["error"]): string {
  if (!error) return "";
  const parts: string[] = [];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.kind) parts.push(`kind=${error.kind}`);
  if (error.source) parts.push(`source=${error.source}`);
  if (error.message) parts.push(`message=${error.message}`);
  return parts.join(" ");
}
