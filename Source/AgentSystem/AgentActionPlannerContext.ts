import crypto from "node:crypto";
import type {
  ActionPlanInput,
  ExecutionDelta,
} from "./BamlClient/baml_client/types.js";
import { ExecutionDeltaOp, ToolCallStatus } from "./BamlClient/baml_client/types.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { ExecutedToolCallResult } from "./Types.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
import { AgentXmlParser } from "./AgentXmlParser.js";
import {
  createXmlProtocolSpec,
  listXmlArrayElementNames,
} from "./AgentXmlPolicy.js";

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
  private readonly historyProjector: AgentActionPlannerHistoryProjector;

  constructor() {
    this.historyProjector = new AgentActionPlannerHistoryProjector();
  }

  buildInput(options: {
    userMessage: string;
    currentStep: number;
    dynamicTools: boolean;
    loadedToolNames: "all" | readonly string[];
    messages: readonly AgentLanguageModelMessage[];
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
      history: this.historyProjector.project(options.messages),
      executionState: {
        calls: options.ledger.calls,
        evidence: options.ledger.evidence,
        warnings: options.ledger.warnings,
        progress: {
          totalToolCalls: options.ledger.calls.length,
          totalEvidence: options.ledger.evidence.length,
          lastNewEvidenceStep: options.ledger.lastNewEvidenceStep,
          repeatedCallCount: options.ledger.warnings.length,
          stalled: this.isStalled(options.currentStep, options.ledger),
        },
      },
      recentDeltas: options.ledger.deltas,
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
    const evidence = collectEvidence(result, artifactId);
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

class AgentActionPlannerHistoryProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly parser = new AgentXmlParser({
    arrayElementNames: listXmlArrayElementNames(this.protocol),
    arrayElementNameSuffix: this.protocol.arrayElementNameSuffix,
  });

  project(messages: readonly AgentLanguageModelMessage[]): Array<{
    index: number;
    role: string;
    kind: string;
    content: string;
  }> {
    return messages.map((message, index) => ({
      index,
      role: message.role,
      ...this.projectMessage(message),
    }));
  }

  private projectMessage(message: AgentLanguageModelMessage): {
    kind: string;
    content: string;
  } {
    const parsed = this.tryParseXml(message.content);
    const projected = parsed ? this.projectXmlRoot(parsed.rootName, parsed.value, message.content) : undefined;
    if (projected) {
      return projected;
    }

    return {
      kind: message.role === "assistant" ? "assistant_message" : "user_message",
      content: message.content,
    };
  }

  private projectXmlRoot(rootName: string, value: unknown, source: string): {
    kind: string;
    content: string;
  } | undefined {
    if (rootName === "read_only_evidence") {
      return this.projectReadOnlyEvidence(value);
    }

    if (rootName === this.protocol.roots.toolCalls) {
      return {
        kind: "tool_call",
        content: stringifyPreview(this.projectToolCalls(value)),
      };
    }

    if (rootName === this.protocol.roots.toolResults) {
      return {
        kind: "tool_result",
        content: stringifyPreview(this.projectToolResults(value)),
      };
    }

    return source.trimStart().startsWith(`<${rootName}`)
      ? {
          kind: "xml_observation",
          content: stringifyPreview(value),
        }
      : undefined;
  }

  private projectReadOnlyEvidence(value: unknown): {
    kind: string;
    content: string;
  } | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const kind = readString(record.kind) ?? "read_only_evidence";
    const payload = record.payload;
    const normalizedPayload = kind === "tool_results"
      ? this.projectReadOnlyToolResults(payload)
      : payload;

    return {
      kind,
      content: stringifyPreview(normalizedPayload),
    };
  }

  private projectReadOnlyToolResults(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const result = (value as Record<string, unknown>).result;
    return {
      result: Array.isArray(result)
        ? result.map((entry) => this.projectToolResultItem(entry))
        : result,
    };
  }

  private projectToolCalls(value: unknown): unknown {
    return readArrayItems(value, this.protocol.items.toolCall).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      return {
        name: readString(record[this.protocol.toolCall.name]) ?? "",
        arguments: record[this.protocol.toolCall.arguments] ?? {},
      };
    });
  }

  private projectToolResults(value: unknown): unknown {
    return readArrayItems(value, this.protocol.items.toolResult).map((entry) =>
      this.projectToolResultItem(entry));
  }

  private projectToolResultItem(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return compactObject({
      callId: record[this.protocol.toolResult.callId],
      name: record[this.protocol.toolResult.name],
      arguments: record[this.protocol.toolResult.arguments],
      result: record[this.protocol.toolResult.result],
      runtime: this.projectToolRuntime(record[this.protocol.toolResult.runtime]),
      response: this.projectToolResponse(record[this.protocol.toolResult.response]),
    });
  }

  private projectToolRuntime(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    return compactObject({
      exitCode: record.exitCode,
      signal: record.signal,
      stderr: record.stderr,
    });
  }

  private projectToolResponse(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    return compactObject({
      ok: record.ok,
      error: record.error,
    });
  }

  private tryParseXml(value: string) {
    try {
      return this.parser.parse(value);
    } catch {
      return undefined;
    }
  }
}

export function buildInitialActionPlannerLedger(
  _messages: readonly AgentLanguageModelMessage[] | undefined,
): AgentActionPlannerLedger {
  return EmptyActionPlannerLedger;
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
): PlannerEvidenceRecord[] {
  const records = collectPathEvidence(result.result, artifactId);
  return records.length > 0
    ? records
    : [{
        key: `tool:${result.name}:${artifactId}`,
        kind: "tool_result",
        label: result.name,
        artifactId,
        source: stringifyPreview(result.result),
      }];
}

function readArrayItems(value: unknown, itemKey: string): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const item = (value as Record<string, unknown>)[itemKey];
  return Array.isArray(item)
    ? item
    : item !== undefined
      ? [item]
      : [];
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      entry !== undefined
      && entry !== ""
      && !(Array.isArray(entry) && entry.length === 0)),
  );
}

function collectPathEvidence(
  value: unknown,
  artifactId: string,
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
      source: readString(entry.snippet) ?? readString(entry.content) ?? title,
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
