import crypto from "node:crypto";
import type {
  ActionPlanInput,
  ExecutionDelta,
} from "./BamlClient/baml_client/types.js";
import { ExecutionDeltaOp, ToolCallStatus } from "./BamlClient/baml_client/types.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { ExecutedToolCallResult } from "./Types.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";

export interface AgentActionPlannerContextBudget {
  maxRecentDeltas: number;
  maxStateCalls: number;
  maxEvidence: number;
  maxPreviewChars: number;
}

export interface AgentActionPlannerLedger {
  calls: PlannerToolCallRecord[];
  evidence: PlannerEvidenceRecord[];
  warnings: PlannerRepeatedCallWarning[];
  deltas: PlannerExecutionDelta[];
  lastNewEvidenceStep: number;
}

export interface PlannerToolCallRecord {
  step: number;
  toolName: string;
  argsHash: string;
  status: ToolCallStatus;
  artifactId: string;
  evidenceKeys: string[];
  error: string;
}

export interface PlannerEvidenceRecord {
  key: string;
  kind: string;
  label: string;
  artifactId: string;
  source: string;
}

export interface PlannerRepeatedCallWarning {
  toolName: string;
  argsHash: string;
  count: number;
  lastStep: number;
}

export interface PlannerExecutionDelta {
  step: number;
  op: ExecutionDeltaOp;
  key: string;
  toolName: string;
  argsHash: string;
  status: ToolCallStatus;
  artifactId: string;
  evidenceKeys: string[];
  note: string;
}

export const EmptyActionPlannerLedger: AgentActionPlannerLedger = {
  calls: [],
  evidence: [],
  warnings: [],
  deltas: [],
  lastNewEvidenceStep: 0,
};

export class AgentActionPlannerContextBuilder {
  constructor(private readonly budget: AgentActionPlannerContextBudget) {}

  buildInput(options: {
    userMessage: string;
    currentStep: number;
    dynamicTools: boolean;
    loadedToolNames: "all" | readonly string[];
    ledger: AgentActionPlannerLedger;
    toolCatalog: AgentToolCatalogItem[];
  }): ActionPlanInput {
    const loadedTools = options.loadedToolNames === "all"
      ? options.toolCatalog.map((tool) => tool.name)
      : [...options.loadedToolNames];
    const visibleTools = new Set(loadedTools);

    return {
      task: {
        userMessage: options.userMessage,
      },
      runtime: {
        currentStep: options.currentStep,
        dynamicTools: options.dynamicTools,
        loadedTools,
      },
      executionState: {
        calls: tail(options.ledger.calls, this.budget.maxStateCalls),
        evidence: tail(options.ledger.evidence, this.budget.maxEvidence),
        warnings: options.ledger.warnings,
        progress: {
          totalToolCalls: options.ledger.calls.length,
          totalEvidence: options.ledger.evidence.length,
          lastNewEvidenceStep: options.ledger.lastNewEvidenceStep,
          repeatedCallCount: options.ledger.warnings.length,
          stalled: this.isStalled(options.currentStep, options.ledger),
        },
      },
      recentDeltas: tail(options.ledger.deltas, this.budget.maxRecentDeltas),
      toolCatalog: options.toolCatalog.map((tool) => ({
        ...tool,
        loaded: visibleTools.has(tool.name),
      })),
    };
  }

  advanceAfterToolResults(options: {
    ledger: AgentActionPlannerLedger;
    step: number;
    results: readonly ExecutedToolCallResult[];
  }): AgentActionPlannerLedger {
    const next = cloneLedger(options.ledger);
    for (const result of options.results) {
      this.appendToolCall(next, options.step, result);
    }
    next.warnings = this.collectRepeatedWarnings(next.calls);
    return next;
  }

  private appendToolCall(
    ledger: AgentActionPlannerLedger,
    step: number,
    result: ExecutedToolCallResult,
  ): void {
    const argsHash = stableHash(result.arguments);
    const artifactId = stableArtifactId(step, result.name, argsHash, result.result);
    const status = readToolStatus(result.result);
    const evidence = collectEvidence(result, artifactId, this.budget.maxPreviewChars);
    const evidenceKeys = evidence.map((item) => item.key);
    const call: PlannerToolCallRecord = {
      step,
      toolName: result.name,
      argsHash,
      status,
      artifactId,
      evidenceKeys,
      error: status === "Failure" ? readErrorMessage(result.result) : "",
    };

    ledger.calls.push(call);
    ledger.deltas.push({
      step,
      op: ExecutionDeltaOp.AddCall,
      key: `call:${result.name}:${argsHash}`,
      toolName: result.name,
      argsHash,
      status,
      artifactId,
      evidenceKeys,
      note: call.error,
    });

    const existingEvidence = new Set(ledger.evidence.map((item) => item.key));
    for (const entry of evidence) {
      if (existingEvidence.has(entry.key)) {
        continue;
      }
      ledger.evidence.push(entry);
      existingEvidence.add(entry.key);
      ledger.lastNewEvidenceStep = step;
      ledger.deltas.push({
        step,
        op: ExecutionDeltaOp.AddEvidence,
        key: entry.key,
        toolName: result.name,
        argsHash,
        status,
        artifactId,
        evidenceKeys: [entry.key],
        note: entry.label,
      });
    }
  }

  private collectRepeatedWarnings(
    calls: readonly PlannerToolCallRecord[],
  ): PlannerRepeatedCallWarning[] {
    const bySignature = new Map<string, PlannerRepeatedCallWarning>();
    for (const call of calls) {
      const key = `${call.toolName}:${call.argsHash}`;
      const current = bySignature.get(key);
      bySignature.set(key, {
        toolName: call.toolName,
        argsHash: call.argsHash,
        count: (current?.count ?? 0) + 1,
        lastStep: call.step,
      });
    }

    return [...bySignature.values()].filter((entry) => entry.count > 1);
  }

  private isStalled(currentStep: number, ledger: AgentActionPlannerLedger): boolean {
    return ledger.calls.length > 0
      && ledger.lastNewEvidenceStep > 0
      && currentStep - ledger.lastNewEvidenceStep >= 2;
  }
}

export function buildInitialActionPlannerLedger(
  messages: readonly AgentLanguageModelMessage[] | undefined,
): AgentActionPlannerLedger {
  if (!messages || messages.length === 0) {
    return EmptyActionPlannerLedger;
  }

  return {
    ...EmptyActionPlannerLedger,
    evidence: tail(messages, 4).map((message, index) => ({
      key: `history:${index}:${stableHash(message)}`,
      kind: "history",
      label: message.role,
      artifactId: `history:${stableHash(message.content)}`,
      source: truncateText(message.content, 240),
    })),
  };
}

function cloneLedger(ledger: AgentActionPlannerLedger): AgentActionPlannerLedger {
  return {
    calls: [...ledger.calls],
    evidence: [...ledger.evidence],
    warnings: [...ledger.warnings],
    deltas: [...ledger.deltas],
    lastNewEvidenceStep: ledger.lastNewEvidenceStep,
  };
}

function collectEvidence(
  result: ExecutedToolCallResult,
  artifactId: string,
  maxPreviewChars: number,
): PlannerEvidenceRecord[] {
  const records = collectPathEvidence(result.result, artifactId, maxPreviewChars);
  return records.length > 0
    ? records
    : [{
        key: `tool:${result.name}:${artifactId}`,
        kind: "tool_result",
        label: result.name,
        artifactId,
        source: truncateText(stringifyPreview(result.result), maxPreviewChars),
      }];
}

function collectPathEvidence(
  value: unknown,
  artifactId: string,
  maxPreviewChars: number,
): PlannerEvidenceRecord[] {
  const records: PlannerEvidenceRecord[] = [];
  visitJson(value, (entry) => {
    const path = readString(entry.path) ?? readString(entry.file) ?? readString(entry.filePath);
    const url = readString(entry.url) ?? readString(entry.href);
    const title = readString(entry.title) ?? readString(entry.name) ?? path ?? url ?? "";
    const key = path
      ? `file:${path}`
      : url
        ? `url:${url}`
        : undefined;

    if (!key || records.some((record) => record.key === key)) {
      return;
    }

    records.push({
      key,
      kind: path ? "file" : "url",
      label: title,
      artifactId,
      source: truncateText(readString(entry.snippet) ?? readString(entry.content) ?? title, maxPreviewChars),
    });
  });
  return records;
}

function visitJson(value: unknown, visit: (entry: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visitJson(item, visit);
    }
    return;
  }

  const entry = value as Record<string, unknown>;
  visit(entry);
  for (const item of Object.values(entry)) {
    visitJson(item, visit);
  }
}

function readToolStatus(result: unknown): ToolCallStatus {
  if (hasError(result)) {
    return ToolCallStatus.Failure;
  }

  return isEmptyResult(result) ? ToolCallStatus.Empty : ToolCallStatus.Success;
}

function hasError(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "error" in value);
}

function isEmptyResult(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function readErrorMessage(value: unknown): string {
  if (!hasError(value)) {
    return "";
  }

  const error = (value as Record<string, unknown>).error;
  return error && typeof error === "object" && !Array.isArray(error)
    ? readString((error as Record<string, unknown>).message) ?? stringifyPreview(error)
    : stringifyPreview(error);
}

function stableArtifactId(
  step: number,
  toolName: string,
  argsHash: string,
  result: unknown,
): string {
  return `artifact:${step}:${toolName}:${argsHash}:${stableHash(result).slice(0, 12)}`;
}

function stableHash(value: unknown): string {
  return crypto
    .createHash("sha1")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function stringifyPreview(value: unknown): string {
  return typeof value === "string" ? value : stableStringify(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function tail<T>(values: readonly T[], maxItems: number): T[] {
  return maxItems <= 0 ? [] : values.slice(-maxItems);
}
