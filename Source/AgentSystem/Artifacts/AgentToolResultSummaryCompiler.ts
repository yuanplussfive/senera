import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  AgentToolResultSummaryType,
  type AgentToolResultSummary,
  type AgentToolResultSummaryChange,
  type AgentToolResultSummaryFact,
  type AgentToolResultSummaryStatus,
} from "../Types/AgentToolResultSummaryTypes.js";
import type {
  ToolArtifactDeltaRecord,
  ToolArtifactEvidenceRecord,
  ToolWorkspaceCaptureResult,
} from "../Types/ToolRuntimeTypes.js";
import { stableArtifactStringify } from "./AgentArtifactStableJson.js";

export interface AgentToolResultSummaryCompilerOptions {
  model: string;
  policy?: Partial<AgentToolResultSummaryTokenPolicy>;
}

export interface AgentToolResultSummaryCompilerInput {
  toolName: string;
  callId: string;
  status: AgentToolResultSummaryStatus;
  artifactUri: string;
  deterministicSummary: string;
  result: unknown;
  evidence: readonly ToolArtifactEvidenceRecord[];
  delta: readonly ToolArtifactDeltaRecord[];
  workspace?: ToolWorkspaceCaptureResult;
}

export interface AgentToolResultSummaryTokenPolicy {
  headlineTokens: number;
  summaryTokens: number;
  factValueTokens: number;
  changeSummaryTokens: number;
  limitationTokens: number;
  maxFacts: number;
  maxChanges: number;
}

const DefaultToolResultSummaryTokenPolicy = {
  headlineTokens: 64,
  summaryTokens: 700,
  factValueTokens: 160,
  changeSummaryTokens: 128,
  limitationTokens: 80,
  maxFacts: 64,
  maxChanges: 64,
} as const satisfies AgentToolResultSummaryTokenPolicy;

export class AgentToolResultSummaryCompiler {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly policy: AgentToolResultSummaryTokenPolicy;

  constructor(options: AgentToolResultSummaryCompilerOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.policy = {
      ...DefaultToolResultSummaryTokenPolicy,
      ...options.policy,
    };
  }

  compile(input: AgentToolResultSummaryCompilerInput): AgentToolResultSummary {
    const projectedFacts = this.projectFacts(input.evidence);
    const facts = projectedFacts.items;
    const projectedChanges = this.projectChanges(input.delta, input.workspace);
    const changes = projectedChanges.items;
    const sourceSummary = this.buildSourceSummary({
      ...input,
      facts,
      changes,
    });
    const summaryPreview = this.tokenProjector.previewText(sourceSummary, this.policy.summaryTokens);
    const headlinePreview = this.tokenProjector.previewText(
      this.buildHeadline(input, summaryPreview.text, facts, changes),
      this.policy.headlineTokens,
    );
    const limitations = this.projectLimitations([
      ...(summaryPreview.truncated
        ? ["Summary was token-truncated; retrieve the artifact for the full projection."]
        : []),
      ...(projectedFacts.omitted > 0
        ? [`${projectedFacts.omitted} evidence facts were omitted from the context projection.`]
        : []),
      ...(projectedChanges.omitted > 0
        ? [`${projectedChanges.omitted} change records were omitted from the context projection.`]
        : []),
      ...(input.deterministicSummary.trim()
        ? []
        : ["No plugin summary template produced a dedicated summary for this result."]),
    ]);

    return {
      type: AgentToolResultSummaryType,
      version: 1,
      toolName: input.toolName,
      callId: input.callId,
      status: input.status,
      artifactUri: input.artifactUri,
      headline: headlinePreview.text,
      summary: summaryPreview.text,
      facts,
      changes,
      limitations,
      retrieval: {
        artifactUri: input.artifactUri,
        refs: this.retrievalRefs(input, facts, changes),
      },
      stats: {
        summaryTokens: summaryPreview.tokenCount,
        summaryTokenLimit: summaryPreview.tokenLimit,
        summaryTruncated: summaryPreview.truncated,
        factCount: facts.length,
        omittedFacts: projectedFacts.omitted,
        changeCount: changes.length,
        omittedChanges: projectedChanges.omitted,
      },
    };
  }

  renderMarkdown(summary: AgentToolResultSummary): string {
    const lines = [
      `# ${summary.headline}`,
      "",
      `tool: ${summary.toolName}`,
      `status: ${summary.status}`,
      `artifactUri: ${summary.artifactUri}`,
      "",
      summary.summary,
    ];

    if (summary.facts.length > 0) {
      lines.push("", "facts:");
      for (const fact of summary.facts) {
        const source = fact.evidenceUri ? ` (${fact.evidenceUri})` : "";
        lines.push(`- ${fact.name}: ${fact.value}${source}`);
      }
    }

    if (summary.changes.length > 0) {
      lines.push("", "changes:");
      for (const change of summary.changes) {
        lines.push(`- ${change.status} ${change.key}: ${change.summary}`);
      }
    }

    if (summary.limitations.length > 0) {
      lines.push("", "limitations:");
      for (const limitation of summary.limitations) {
        lines.push(`- ${limitation}`);
      }
    }

    lines.push("", "retrieval:");
    lines.push(`- artifactUri: ${summary.retrieval.artifactUri}`);
    lines.push(`- refs: ${summary.retrieval.refs.join(", ")}`);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  private projectFacts(evidence: readonly ToolArtifactEvidenceRecord[]): {
    items: AgentToolResultSummaryFact[];
    omitted: number;
  } {
    const facts = evidence.flatMap((entry) => {
      const sourceFacts = entry.plannerMemory.facts.length > 0 ? entry.plannerMemory.facts : entry.modelSlots;
      return sourceFacts.flatMap((fact) => {
        const name = fact.name.trim();
        const value = fact.value.trim();
        if (!name || !value) {
          return [];
        }
        return [
          {
            name,
            value: this.tokenProjector.previewText(value, this.policy.factValueTokens).text,
            evidenceUri: entry.evidenceUri,
            kind: entry.kind,
            confidence: entry.confidence,
            artifactRefs: [...entry.plannerMemory.artifactRefs],
          } satisfies AgentToolResultSummaryFact,
        ];
      });
    });
    return limitItems(facts, this.policy.maxFacts);
  }

  private projectChanges(
    delta: readonly ToolArtifactDeltaRecord[],
    workspace: ToolWorkspaceCaptureResult | undefined,
  ): { items: AgentToolResultSummaryChange[]; omitted: number } {
    const deltaChanges = delta.map(
      (entry) =>
        ({
          kind: entry.kind,
          status: entry.status,
          key: entry.kind === "evidence" ? entry.summary : entry.key,
          summary: this.tokenProjector.previewText(entry.summary, this.policy.changeSummaryTokens).text,
        }) satisfies AgentToolResultSummaryChange,
    );
    const workspaceChanges = (workspace?.changes ?? []).map(
      (entry) =>
        ({
          kind: "workspace",
          status: entry.status,
          key: entry.path,
          summary: this.tokenProjector.previewText(`${entry.status}: ${entry.path}`, this.policy.changeSummaryTokens)
            .text,
        }) satisfies AgentToolResultSummaryChange,
    );
    return limitItems(uniqueChanges([...deltaChanges, ...workspaceChanges]), this.policy.maxChanges);
  }

  private buildSourceSummary(
    input: AgentToolResultSummaryCompilerInput & {
      facts: readonly AgentToolResultSummaryFact[];
      changes: readonly AgentToolResultSummaryChange[];
    },
  ): string {
    const deterministic = input.deterministicSummary.trim();
    if (deterministic) {
      return deterministic;
    }

    const factLines = input.facts.map((fact) => `- ${fact.name}: ${fact.value}`);
    if (factLines.length > 0) {
      return factLines.join("\n");
    }

    const changeLines = input.changes.map((change) => `- ${change.status} ${change.key}: ${change.summary}`);
    if (changeLines.length > 0) {
      return changeLines.join("\n");
    }

    const resultShape = describeResultShape(input.result);
    return `${input.toolName} completed with status ${input.status}. Full result is stored in artifact ${input.artifactUri}. ${resultShape}`;
  }

  private buildHeadline(
    input: AgentToolResultSummaryCompilerInput,
    summary: string,
    facts: readonly AgentToolResultSummaryFact[],
    changes: readonly AgentToolResultSummaryChange[],
  ): string {
    const firstSummaryLine = summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^-+\s*/, "").trim())
      .find(Boolean);
    if (firstSummaryLine) {
      return firstSummaryLine;
    }
    const firstFact = facts[0];
    if (firstFact) {
      return `${firstFact.name}: ${firstFact.value}`;
    }
    const firstChange = changes[0];
    if (firstChange) {
      return `${firstChange.status} ${firstChange.key}`;
    }
    return `${input.toolName} ${input.status}`;
  }

  private projectLimitations(values: readonly string[]): string[] {
    return uniqueStrings(values).map(
      (value) => this.tokenProjector.previewText(value, this.policy.limitationTokens).text,
    );
  }

  private retrievalRefs(
    input: AgentToolResultSummaryCompilerInput,
    facts: readonly AgentToolResultSummaryFact[],
    changes: readonly AgentToolResultSummaryChange[],
  ): string[] {
    return uniqueStrings([
      "summary",
      "summaryJson",
      "projection",
      "evidence",
      ...(input.deterministicSummary.trim() ? [] : ["raw"]),
      ...facts.flatMap((fact) => fact.artifactRefs),
      ...(changes.length > 0 ? ["delta"] : []),
      ...(input.workspace ? ["workspace"] : []),
    ]);
  }
}

function limitItems<T>(items: readonly T[], limit: number): { items: T[]; omitted: number } {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const projected = items.slice(0, normalizedLimit);
  return {
    items: projected,
    omitted: Math.max(0, items.length - projected.length),
  };
}

function uniqueChanges(changes: readonly AgentToolResultSummaryChange[]): AgentToolResultSummaryChange[] {
  const byKey = new Map<string, AgentToolResultSummaryChange>();
  for (const change of changes) {
    byKey.set(`${change.kind}:${change.key}:${change.status}`, change);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function describeResultShape(value: unknown): string {
  if (value === undefined || value === null) {
    return "The tool returned no structured payload.";
  }
  if (Array.isArray(value)) {
    return `The raw result is an array with ${value.length} item(s).`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `The raw result is an object with keys: ${keys.slice(0, 16).join(", ") || "none"}.`;
  }
  return `The raw result is ${stableArtifactStringify(value)}.`;
}
