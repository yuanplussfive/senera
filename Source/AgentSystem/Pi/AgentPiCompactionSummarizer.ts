import { serializeConversation, type CompactionPreparation, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { PiCompactionSummary } from "../BamlClient/baml_client/types.js";
import type { AgentPiContextEvidenceItem } from "./AgentPiContextPolicy.js";
import type { AgentPiCompactionInspection } from "./AgentPiCompactionPolicy.js";
import type { AgentPiCompactionPromptInput } from "./AgentPiCompactionPrompt.js";

export interface AgentPiCompactionModelClient {
  compactPiSession(
    input: AgentPiCompactionPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<PiCompactionSummary>;
}

export interface AgentPiCompactionRequest {
  preparation: CompactionPreparation;
  inspection: AgentPiCompactionInspection;
  objective?: string;
  customInstructions?: string;
  evidence?: readonly AgentPiContextEvidenceItem[];
  signal?: AbortSignal;
}

export interface AgentPiPreparedCompaction {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details: {
    readFiles: string[];
    modifiedFiles: string[];
    pressureReasons: AgentPiCompactionInspection["pressureReasons"];
    effectiveTokenBudget: number;
    effectiveMessageBudget: number;
  };
}

export class AgentPiCompactionSummarizer {
  constructor(private readonly client: AgentPiCompactionModelClient) {}

  async summarize(request: AgentPiCompactionRequest): Promise<AgentPiPreparedCompaction> {
    const preparation = request.preparation;
    const files = projectFileOperations(preparation);
    const summary = normalizeSummary(
      await this.client.compactPiSession(
        {
          previousSummary: preparation.previousSummary,
          compactedConversation: serializeConversation(projectSerializableMessages(preparation.messagesToSummarize)),
          splitTurnPrefix:
            serializeConversation(projectSerializableMessages(preparation.turnPrefixMessages)) || undefined,
          objective: request.objective,
          customInstructions: request.customInstructions,
          readFiles: files.readFiles,
          modifiedFiles: files.modifiedFiles,
          evidence: [...(request.evidence ?? [])],
        },
        { signal: request.signal },
      ),
    );

    return {
      summary: renderSummary(summary, files),
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: {
        ...files,
        pressureReasons: request.inspection.pressureReasons,
        effectiveTokenBudget: request.inspection.effectiveTokenBudget,
        effectiveMessageBudget: request.inspection.effectiveMessageBudget,
      },
    };
  }
}

function projectSerializableMessages(messages: readonly AgentMessage[]): Message[] {
  return messages.flatMap((message) =>
    message.role === "user" || message.role === "assistant" || message.role === "toolResult"
      ? [message as Message]
      : [],
  );
}

function normalizeSummary(summary: PiCompactionSummary): PiCompactionSummary {
  const normalized = {
    goals: normalizeItems(summary.goals),
    constraints: normalizeItems(summary.constraints),
    completed: normalizeItems(summary.completed),
    inProgress: normalizeItems(summary.inProgress),
    blocked: normalizeItems(summary.blocked),
    decisions: summary.decisions.flatMap((item) => {
      const decision = item.decision.trim();
      const rationale = item.rationale.trim();
      return decision ? [{ decision, rationale }] : [];
    }),
    nextSteps: normalizeItems(summary.nextSteps),
    criticalContext: normalizeItems(summary.criticalContext),
  };
  const itemCount = Object.values(normalized).reduce((total, items) => total + items.length, 0);
  if (itemCount === 0) throw new Error("Pi compaction summary did not contain any durable context.");
  return normalized;
}

function normalizeItems(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function renderSummary(summary: PiCompactionSummary, files: { readFiles: string[]; modifiedFiles: string[] }): string {
  const sections = [
    renderSection("## Goal", summary.goals),
    renderSection("## Constraints & Preferences", summary.constraints),
    [
      "## Progress",
      renderChecklist("### Done", summary.completed, true),
      renderChecklist("### In Progress", summary.inProgress, false),
      renderSection("### Blocked", summary.blocked),
    ].join("\n\n"),
    renderSection(
      "## Key Decisions",
      summary.decisions.map((item) =>
        item.rationale ? `**${item.decision}**: ${item.rationale}` : `**${item.decision}**`,
      ),
    ),
    renderNumberedSection("## Next Steps", summary.nextSteps),
    renderSection("## Critical Context", summary.criticalContext),
  ];
  if (files.readFiles.length > 0) sections.push(`<read-files>\n${files.readFiles.join("\n")}\n</read-files>`);
  if (files.modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${files.modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.join("\n\n");
}

function renderSection(title: string, items: readonly string[]): string {
  return `${title}\n${items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)"}`;
}

function renderChecklist(title: string, items: readonly string[], completed: boolean): string {
  const marker = completed ? "x" : " ";
  return `${title}\n${items.length > 0 ? items.map((item) => `- [${marker}] ${item}`).join("\n") : "- (none)"}`;
}

function renderNumberedSection(title: string, items: readonly string[]): string {
  return `${title}\n${items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. (none)"}`;
}

function projectFileOperations(preparation: CompactionPreparation): { readFiles: string[]; modifiedFiles: string[] } {
  const modified = new Set([...preparation.fileOps.written, ...preparation.fileOps.edited]);
  return {
    readFiles: [...preparation.fileOps.read].filter((file) => !modified.has(file)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}
