import type { ActionPlanInput } from "./BamlClient/baml_client/types.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { ExecutedToolCallResult } from "./Types.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
import type { AgentActivatedSkill } from "./AgentSkillActivation.js";
import {
  DefaultAgentArtifactRootDir,
} from "./Artifacts/AgentArtifactLocator.js";
import { AgentDefaults } from "./AgentDefaults.js";
import {
  AgentActionPlannerLedgerUpdater,
  isActionPlannerLedgerStalled,
  type AgentActionPlannerLedger,
} from "./AgentActionPlannerLedger.js";
import { AgentActionPlannerTimelineProjector } from "./AgentActionPlannerTimelineProjector.js";
import {
  AgentPlannerMemoryProjector,
} from "./AgentPlannerMemory.js";

export type {
  AgentActionPlannerLedger,
  PlannerEvidenceRecord,
  PlannerExecutionDelta,
  PlannerRepeatedCallWarning,
  PlannerToolCallRecord,
} from "./AgentActionPlannerLedger.js";
export {
  buildInitialActionPlannerLedger,
  EmptyActionPlannerLedger,
} from "./AgentActionPlannerLedger.js";

export class AgentActionPlannerContextBuilder {
  private readonly ledgerUpdater: AgentActionPlannerLedgerUpdater;
  private readonly timelineProjector: AgentActionPlannerTimelineProjector;
  private readonly memoryProjector: AgentPlannerMemoryProjector;
  private readonly stalledStepLag: number;

  constructor(
    workspaceRoot: string = process.cwd(),
    artifactRootDir: string = DefaultAgentArtifactRootDir,
    options: {
      stalledStepLag: number;
    } = {
      stalledStepLag: AgentDefaults.ActionPlanner.Evidence.StalledStepLag,
    },
  ) {
    this.ledgerUpdater = new AgentActionPlannerLedgerUpdater(workspaceRoot, artifactRootDir);
    this.timelineProjector = new AgentActionPlannerTimelineProjector();
    this.memoryProjector = new AgentPlannerMemoryProjector();
    this.stalledStepLag = options.stalledStepLag;
  }

  buildInput(options: {
    requestId?: string;
    userMessage: string;
    currentStep: number;
    dynamicTools: boolean;
    loadedToolNames: "all" | readonly string[];
    messages: readonly AgentLanguageModelMessage[];
    conversationEntries?: readonly AgentConversationEntry[];
    ledger: AgentActionPlannerLedger;
    toolCatalog: AgentToolCatalogItem[];
    activeSkills?: readonly AgentActivatedSkill[];
  }): ActionPlanInput {
    const loadedTools = options.loadedToolNames === "all"
      ? options.toolCatalog.map((tool) => tool.name)
      : [...options.loadedToolNames];
    const visibleTools = new Set(loadedTools);
    const memory = this.memoryProjector.project(options.conversationEntries ?? [], {
      excludeEvidenceRequestId: options.requestId,
    });
    const evidenceState = [
      ...memory.evidenceMemory.map((entry) => ({
        evidenceRef: entry.evidenceRef,
        kind: entry.kind,
        toolName: entry.toolName,
        artifactUri: entry.artifactUri,
        locator: entry.locator,
        display: entry.display,
        label: entry.label,
        facts: entry.facts,
        artifactRefs: entry.artifactRefs,
      })),
      ...options.ledger.evidence.map((entry) => {
        const call = options.ledger.calls.find((candidate) =>
          candidate.evidenceRefs.includes(entry.evidenceRef));
        return {
          evidenceRef: entry.evidenceRef,
          kind: entry.kind,
          toolName: call?.toolName ?? "",
          artifactUri: entry.artifactUri,
          locator: entry.locator,
          display: entry.display,
          label: entry.label,
          source: entry.source,
          confidence: entry.confidence,
          facts: entry.modelSlots,
          artifactRefs: [entry.artifactUri],
        };
      }),
    ];

    void options.userMessage;
    return {
      runState: {
        currentStep: options.currentStep,
        dynamicTools: options.dynamicTools,
        loadedTools,
        progress: {
          totalToolCalls: options.ledger.calls.length,
          totalEvidence: options.ledger.evidence.length,
          lastNewEvidenceStep: options.ledger.lastNewEvidenceStep,
          repeatedCallCount: options.ledger.warnings.length,
          stalled: isActionPlannerLedgerStalled(options.currentStep, options.ledger, {
            stalledStepLag: this.stalledStepLag,
          }),
        },
        warnings: options.ledger.warnings,
        calls: options.ledger.calls.map((call) => ({
          step: call.step,
          toolName: call.toolName,
          status: call.status,
          artifactUri: call.artifactUri,
          evidenceRefs: call.evidenceRefs,
          resultKind: call.resultKind,
          argumentsPreview: call.argumentsPreview,
          error: call.error,
        })),
      },
      timeline: this.timelineProjector.project({
        messages: options.messages,
        ledger: options.ledger,
      }),
      evidenceMemory: memory.evidenceMemory,
      evidenceState,
      plannerJournal: memory.plannerJournal,
      compactToolCatalog: options.toolCatalog.map((tool) =>
        projectCompactToolCatalogItem(tool, visibleTools)),
      toolCatalog: options.toolCatalog.map((tool) => ({
        ...tool,
        loaded: visibleTools.has(tool.name),
      })),
      activeSkills: (options.activeSkills ?? []).map(projectActiveSkillForPlanner),
    };
  }

  advanceAfterToolResults(options: {
    requestId?: string;
    ledger: AgentActionPlannerLedger;
    step: number;
    results: readonly ExecutedToolCallResult[];
  }): AgentActionPlannerLedger {
    return this.ledgerUpdater.advanceAfterToolResults(options);
  }
}

function projectCompactToolCatalogItem(
  tool: AgentToolCatalogItem,
  visibleTools: ReadonlySet<string>,
): ActionPlanInput["compactToolCatalog"][number] {
  return {
    name: tool.name,
    title: tool.title,
    summary: tool.summary,
    capabilities: uniqueStrings(tool.capabilities.flatMap((capability) => [
      capability.id,
      capability.title,
      capability.description,
    ])),
    evidence: uniqueStrings([
      ...tool.evidenceCapabilities.flatMap((capability) => [
        capability.produces,
        ...capability.satisfies,
        ...capability.kinds,
      ]),
      ...tool.capabilities.flatMap((capability) => capability.facets.Evidence ?? []),
    ]),
    effects: uniqueStrings(tool.capabilities.flatMap((capability) =>
      capability.facets.Effects ?? [])),
    outputs: uniqueStrings(tool.capabilities.flatMap((capability) =>
      capability.facets.Outputs ?? [])),
    permissions: tool.permissions,
    loaded: visibleTools.has(tool.name),
    rootKind: tool.rootKind,
  };
}

function projectActiveSkillForPlanner(skill: AgentActivatedSkill): ActionPlanInput["activeSkills"][number] {
  return {
    name: skill.name,
    title: skill.title,
    summary: skill.summary,
    useCases: skill.useCases,
    avoid: skill.avoid,
    recommendedTools: skill.recommendedTools,
    evidenceRequirements: skill.evidenceRequirements.map((requirement) => ({
      need: requirement.Need,
      accepts: requirement.Accepts,
      minimumQuality: requirement.MinimumQuality ?? [],
      minimum: requirement.Minimum ?? 1,
      purpose: requirement.Purpose ?? "",
    })),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
