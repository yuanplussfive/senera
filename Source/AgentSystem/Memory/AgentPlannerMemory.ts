import type {
  PlannerEvidenceMemoryItem,
  PlannerJournalItem,
} from "../BamlClient/baml_client/types.js";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
  type AgentConversationEntry,
} from "../Conversation/AgentConversation.js";
import type { AgentActionPlanResult } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerLedger.js";
import {
  stableStringify,
  uniqueStrings,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import {
  normalizeAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import {
  createPlannerStateSnapshot,
  latestPlannerStateSnapshot,
  type AgentPlannerStateSnapshotRecord,
} from "../AgentPlannerState.js";

export interface AgentPlannerJournalEntryRecord {
  requestId: string;
  step: number;
  selectedAction: string;
  decision: unknown;
  evidenceUris: string[];
  artifactUris: string[];
  loadedTools: string[];
  result: string;
  createdAt: string;
}

export interface AgentToolEvidenceMemoryEntryRecord {
  requestId: string;
  step: number;
  toolName: string;
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  evidence: PlannerEvidenceMemoryItem[];
  createdAt: string;
}

export interface PlannerMemorySnapshot {
  evidenceMemory: PlannerEvidenceMemoryItem[];
  plannerJournal: PlannerJournalItem[];
  plannerStates: AgentPlannerStateSnapshotRecord[];
  activePlannerState?: AgentPlannerStateSnapshotRecord;
}

export class AgentPlannerMemoryProjector {
  project(
    entries: readonly AgentConversationEntry[],
    options: {
      excludeEvidenceRequestId?: string;
    } = {},
  ): PlannerMemorySnapshot {
    const plannerStates = this.projectPlannerStates(entries);
    return {
      evidenceMemory: this.projectEvidenceMemory(entries, options),
      plannerJournal: this.projectPlannerJournal(entries),
      plannerStates,
      activePlannerState: latestPlannerStateSnapshot(plannerStates),
    };
  }

  projectEvidenceMemory(
    entries: readonly AgentConversationEntry[],
    options: {
      excludeEvidenceRequestId?: string;
    } = {},
  ): PlannerEvidenceMemoryItem[] {
    const byIdentity = new Map<string, PlannerEvidenceMemoryItem>();
    for (const entry of entries) {
      if (entry.kind !== AgentConversationEntryKinds.ToolEvidenceMemory) {
        continue;
      }
      if (options.excludeEvidenceRequestId && entry.requestId === options.excludeEvidenceRequestId) {
        continue;
      }
      for (const evidence of entry.record.evidence) {
        const projected = projectEvidenceMemoryItem(evidence);
        byIdentity.set(evidenceMemoryIdentity(projected), projected);
      }
    }
    return [...byIdentity.values()];
  }

  projectPlannerJournal(entries: readonly AgentConversationEntry[]): PlannerJournalItem[] {
    return entries.flatMap((entry) => {
      if (entry.kind !== AgentConversationEntryKinds.PlannerJournal) {
        return [];
      }
      return this.projectJournalRecord(entry.record);
    });
  }

  projectPlannerStates(entries: readonly AgentConversationEntry[]): AgentPlannerStateSnapshotRecord[] {
    return entries.flatMap((entry) => {
      if (entry.kind !== AgentConversationEntryKinds.PlannerStateSnapshot) {
        return [];
      }
      return [entry.record];
    });
  }

  createJournalEntry(options: {
    requestId: string;
    step: number;
    plan: AgentActionPlanResult;
    loadedToolNames: "all" | readonly string[];
    timestamp?: string;
  }): Extract<AgentConversationEntry, { kind: "planner.journal" }> {
    const createdAt = options.timestamp ?? new Date().toISOString();
    return {
      id: createConversationEntryId(options.requestId, "planner", options.step),
      requestId: options.requestId,
      timestamp: createdAt,
      kind: AgentConversationEntryKinds.PlannerJournal,
      record: {
        requestId: options.requestId,
        step: options.step,
        selectedAction: options.plan.decision.action,
        decision: options.plan.decision,
        evidenceUris: options.plan.input.timeline.flatMap((turn) => turn.evidenceUris),
        artifactUris: options.plan.input.timeline.flatMap((turn) => turn.artifactUris),
        loadedTools: options.loadedToolNames === "all" ? ["all"] : [...options.loadedToolNames],
        result: options.plan.kind,
        createdAt,
      },
    };
  }

  createStateSnapshotEntry(options: {
    requestId: string;
    step: number;
    plan: AgentActionPlanResult;
    ledger: AgentActionPlannerLedger;
    loadedToolNames: "all" | readonly string[];
    timestamp?: string;
  }): Extract<AgentConversationEntry, { kind: "planner.state_snapshot" }> | undefined {
    if (!options.plan.taskFrame) {
      return undefined;
    }

    const createdAt = options.timestamp ?? new Date().toISOString();
    return {
      id: createConversationEntryId(options.requestId, "planner_state", options.step),
      requestId: options.requestId,
      timestamp: createdAt,
      kind: AgentConversationEntryKinds.PlannerStateSnapshot,
      record: createPlannerStateSnapshot({
        requestId: options.requestId,
        step: options.step,
        taskFrame: options.plan.taskFrame,
        decision: options.plan.decision,
        ledger: options.ledger,
        loadedToolNames: options.loadedToolNames,
        evidenceMemory: options.plan.input.evidenceMemory,
        timestamp: createdAt,
      }),
    };
  }

  createToolEvidenceMemoryEntries(options: {
    requestId: string;
    step: number;
    results: readonly ExecutedToolCallResult[];
    timestamp?: string;
  }): Array<Extract<AgentConversationEntry, { kind: "tool.evidence_memory" }>> {
    const createdAt = options.timestamp ?? new Date().toISOString();
    return options.results.flatMap((result, index) => {
      const artifact = result.artifact;
      if (!artifact || artifact.evidence.length === 0) {
        return [];
      }

      return {
        id: createConversationEntryId(
          options.requestId,
          "evidence_memory",
          `${options.step}:${index + 1}`,
        ),
        requestId: options.requestId,
        timestamp: createdAt,
        kind: AgentConversationEntryKinds.ToolEvidenceMemory,
        record: {
          requestId: options.requestId,
          step: options.step,
          toolName: result.name,
          artifactId: artifact.artifactId,
          artifactUri: readArtifactUri(artifact.artifactUri),
          artifactPath: artifact.artifactPath,
          evidence: artifact.evidence.map((entry) => ({
            evidenceUri: entry.evidenceUri,
            kind: entry.kind,
            locator: entry.locator,
            display: entry.display,
            label: entry.label,
            toolName: result.name,
            artifactUri: readArtifactUri(artifact.artifactUri),
            facts: entry.plannerMemory.facts,
            artifactRefs: entry.plannerMemory.artifactRefs,
          })),
          createdAt,
        },
      };
    });
  }

  private projectJournalRecord(record: AgentPlannerJournalEntryRecord): PlannerJournalItem[] {
    return [{
      requestId: record.requestId,
      step: record.step,
      selectedAction: record.selectedAction,
      evidenceUris: uniqueStrings(record.evidenceUris),
      artifactUris: uniqueStrings(record.artifactUris),
      loadedTools: uniqueStrings(record.loadedTools),
      outcome: record.result,
    }];
  }
}

export function createPlannerJournalEntry(options: {
  requestId: string;
  step: number;
  plan: AgentActionPlanResult;
  loadedToolNames: "all" | readonly string[];
  timestamp?: string;
}): Extract<AgentConversationEntry, { kind: "planner.journal" }> {
  return new AgentPlannerMemoryProjector().createJournalEntry(options);
}

export function createPlannerStateSnapshotEntry(options: {
  requestId: string;
  step: number;
  plan: AgentActionPlanResult;
  ledger: AgentActionPlannerLedger;
  loadedToolNames: "all" | readonly string[];
  timestamp?: string;
}): Extract<AgentConversationEntry, { kind: "planner.state_snapshot" }> | undefined {
  return new AgentPlannerMemoryProjector().createStateSnapshotEntry(options);
}

export function createToolEvidenceMemoryEntries(options: {
  requestId: string;
  step: number;
  results: readonly ExecutedToolCallResult[];
  timestamp?: string;
}): Array<Extract<AgentConversationEntry, { kind: "tool.evidence_memory" }>> {
  return new AgentPlannerMemoryProjector().createToolEvidenceMemoryEntries(options);
}

function evidenceMemoryIdentity(evidence: PlannerEvidenceMemoryItem): string {
  return stableStringify({
    kind: evidence.kind,
    locator: evidence.locator,
    evidenceUri: evidence.evidenceUri,
    artifactUri: evidence.artifactUri,
  });
}

function projectEvidenceMemoryItem(evidence: PlannerEvidenceMemoryItem): PlannerEvidenceMemoryItem {
  return {
    evidenceUri: evidence.evidenceUri,
    kind: evidence.kind,
    locator: evidence.locator,
    display: evidence.display,
    label: evidence.label,
    toolName: evidence.toolName,
    artifactUri: readArtifactUri(evidence.artifactUri),
    facts: readEvidenceFacts(evidence),
    artifactRefs: readArtifactRefs(evidence),
  };
}

function readArtifactUri(value: string): string {
  return normalizeAgentArtifactUri(value) ?? value;
}

function readEvidenceFacts(evidence: PlannerEvidenceMemoryItem): PlannerEvidenceMemoryItem["facts"] {
  return Array.isArray(evidence.facts) ? [...evidence.facts] : [];
}

function readArtifactRefs(evidence: PlannerEvidenceMemoryItem): string[] {
  return Array.isArray(evidence.artifactRefs) ? [...evidence.artifactRefs] : [];
}
