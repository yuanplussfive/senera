import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type { AgentToolLearningPromptInput } from "../ActionPlanner/AgentLearningPromptJson.js";
import { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import type {
  AgentToolSearchEpisode,
  AgentToolSearchLearnedKeyword,
  AgentToolSearchMemory,
} from "./AgentToolSearchMemory.js";
import type {
  ResolvedAgentModelProviderConfig,
  ResolvedAgentToolLearningConfig,
} from "../Types/AgentConfigTypes.js";
import { parseToolLearningResult } from "./AgentToolLearningSchema.js";
import {
  isRepairablePlanningFailure,
  issueMessages,
  normalizePlanningFailure,
  stringifyIssueValue,
} from "../ActionPlanner/AgentActionPlannerFailure.js";
import { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";

export interface AgentToolLearningEpisodeDraft {
  episode: Omit<AgentToolSearchEpisode, "learnedKeywords">;
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
}

export class AgentToolLearningRuntime {
  private readonly client: AgentActionPlannerModelClient;
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(
    private readonly registry: AgentPluginRegistry,
    model: ResolvedAgentModelProviderConfig,
    private readonly config: ResolvedAgentToolLearningConfig,
    private readonly memory: AgentToolSearchMemory,
  ) {
    this.client = new AgentActionPlannerModelClient(model, config.Client, {
      maxRepairAttempts: config.MaxRepairAttempts,
    });
  }

  enqueue(draft: AgentToolLearningEpisodeDraft): void {
    if (!this.config.Enabled) {
      return;
    }

    void this.learn(draft).catch((error) => {
      this.reportFailure(draft, error);
    });
  }

  private async learn(draft: AgentToolLearningEpisodeDraft): Promise<void> {
    const selectedTools = [...new Set(draft.episode.chosenTools)];
    const toolTagsByName = this.projectToolTagsByName();
    const toolTagCatalogByTool = selectedTools.flatMap((toolName) => {
      const tags = toolTagsByName.get(toolName) ?? [];
      return tags.length > 0 ? [{ toolName, tags }] : [];
    });
    if (toolTagCatalogByTool.length === 0) {
      this.reportSkip(draft, "selected tools do not declare Search.Tags");
      return;
    }

    const candidateSourceTerms = this.candidateSourceTerms(draft);
    const input: AgentToolLearningPromptInput = {
      rawUserTurn: draft.rawUserTurn,
      standaloneRequest: draft.standaloneRequest,
      contextMode: draft.contextMode,
      contextBasis: draft.contextBasis,
      selectedTools,
      candidateSourceTerms,
      toolTagCatalogByTool,
      search: {
        query: draft.episode.query,
        plannerTags: draft.episode.plannerTags,
        candidates: draft.episode.candidates,
      },
      episode: {
        outcome: draft.episode.outcome,
        producedEvidence: draft.episode.finalOutcome.producedEvidence,
        producedArtifact: draft.episode.finalOutcome.producedArtifact,
        changedWorkspace: draft.episode.finalOutcome.changedWorkspace,
      },
    };

    const allowedTags = new Map(
      toolTagCatalogByTool.map((entry) => [entry.toolName, new Set(entry.tags)] as const),
    );
    const parsed = await this.learnAndValidate(input, {
      selectedTools,
      candidateSourceTerms,
      allowedTags,
    });
    const learnedKeywords = parsed.records.flatMap(recordToLearnedTerms);
    if (learnedKeywords.length === 0) {
      this.reportSkip(draft, "BAML returned no reusable tool-learning records");
      return;
    }

    this.memory.record({
      ...draft.episode,
      learnedKeywords,
    });
  }

  private async learnAndValidate(
    input: AgentToolLearningPromptInput,
    options: {
      selectedTools: readonly string[];
      candidateSourceTerms: readonly string[];
      allowedTags: ReadonlyMap<string, ReadonlySet<string>>;
    },
  ) {
    let current = await this.client.learnToolUse(input);
    for (let attempt = 0; attempt <= this.config.MaxRepairAttempts; attempt += 1) {
      try {
        return parseToolLearningResult(current, {
          selectedTools: options.selectedTools,
          candidateSourceTerms: options.candidateSourceTerms,
          toolTagCatalogByTool: options.allowedTags,
        });
      } catch (error) {
        if (attempt >= this.config.MaxRepairAttempts) {
          throw error;
        }
        const failure = normalizePlanningFailure(error);
        if (!isRepairablePlanningFailure(failure.error)) {
          throw error;
        }
        current = await this.client.repairToolLearning({
          input,
          invalidLearning: stringifyIssueValue(failure.invalidOutput ?? failure.error),
          issues: issueMessages(failure.error),
        });
      }
    }

    throw new Error("Tool learning validation did not produce a result.");
  }

  private reportSkip(draft: AgentToolLearningEpisodeDraft, reason: string): void {
    console.debug("[tool-learning] skipped", {
      reason,
      standaloneRequest: draft.standaloneRequest,
      chosenTools: draft.episode.chosenTools,
    });
  }

  private reportFailure(draft: AgentToolLearningEpisodeDraft, error: unknown): void {
    console.warn("[tool-learning] failed", {
      message: error instanceof Error ? error.message : String(error),
      standaloneRequest: draft.standaloneRequest,
      chosenTools: draft.episode.chosenTools,
    });
  }

  private projectToolTagsByName(): Map<string, string[]> {
    return new Map(new AgentToolCatalogProjector(this.registry).list().map((tool) => [
      tool.name,
      tool.tags,
    ]));
  }

  private candidateSourceTerms(draft: AgentToolLearningEpisodeDraft): string[] {
    return uniqueNonEmpty([
      ...this.tokenizer.keywords(draft.standaloneRequest),
      ...this.tokenizer.keywords(draft.episode.query),
    ]);
  }
}

function recordToLearnedTerms(record: {
  toolName: string;
  tags: readonly string[];
  sourceTerms: readonly string[];
  triggers: readonly string[];
  confidence: number;
}): AgentToolSearchLearnedKeyword[] {
  return [
    ...record.tags.map((value) => ({
      toolName: record.toolName,
      value,
      source: "toolLearning.tag",
      weight: record.confidence,
    })),
    ...record.sourceTerms.map((value) => ({
      toolName: record.toolName,
      value,
      source: "toolLearning.sourceTerm",
      weight: record.confidence * 0.8,
    })),
    ...record.triggers.map((value) => ({
      toolName: record.toolName,
      value,
      source: "toolLearning.trigger",
      weight: record.confidence,
    })),
  ];
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
