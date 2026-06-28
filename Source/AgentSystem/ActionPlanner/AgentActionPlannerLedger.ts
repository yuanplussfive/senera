import crypto from "node:crypto";
import type {
  EvidenceSlot,
} from "../BamlClient/baml_client/types.js";
import { ExecutionDeltaOp, ToolCallStatus } from "../BamlClient/baml_client/types.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import {
  DefaultAgentArtifactRootDir,
  createAgentArtifactLocator,
} from "../Artifacts/AgentArtifactLocator.js";
import {
  readString,
  stableStringify,
  stringifyPreview,
} from "./AgentActionPlannerProjectionUtils.js";

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
  argumentsPreview: string;
  status: ToolCallStatus;
  resultKind: string;
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  evidenceUris: string[];
  error: string;
}

export interface PlannerEvidenceRecord {
  key: string;
  evidenceUri: string;
  kind: string;
  locator: string;
  display: string;
  label: string;
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  source: string;
  confidence: number;
  modelSlots: EvidenceSlot[];
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
  key?: string;
  toolName: string;
  argsHash: string;
  status: ToolCallStatus;
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  evidenceUris: string[];
  note: string;
}

export const EmptyActionPlannerLedger: AgentActionPlannerLedger = {
  calls: [],
  evidence: [],
  warnings: [],
  deltas: [],
  lastNewEvidenceStep: 0,
};

export class AgentActionPlannerLedgerUpdater {
  constructor(
    private readonly workspaceRoot: string = process.cwd(),
    private readonly artifactRootDir: string = DefaultAgentArtifactRootDir,
  ) {}

  advanceAfterToolResults(options: {
    requestId?: string;
    ledger: AgentActionPlannerLedger;
    step: number;
    results: readonly ExecutedToolCallResult[];
  }): AgentActionPlannerLedger {
    const next = cloneActionPlannerLedger(options.ledger);
    options.results.forEach((result, index) => {
      this.appendToolCall(next, {
        requestId: options.requestId,
        step: options.step,
        callIndex: index + 1,
        result,
      });
    });
    next.warnings = collectRepeatedWarnings(next.calls);
    return next;
  }

  private appendToolCall(
    ledger: AgentActionPlannerLedger,
    options: {
      requestId?: string;
      step: number;
      callIndex: number;
      result: ExecutedToolCallResult;
    },
  ): void {
    const { result, step } = options;
    const argsHash = stableHash(result.arguments);
    const resultHash = stableHash(result.result);
    const locator = result.artifact ?? createAgentArtifactLocator({
        workspaceRoot: this.workspaceRoot,
        rootDir: this.artifactRootDir,
        requestId: options.requestId,
        step,
        callIndex: options.callIndex,
        toolName: result.name,
        argsHash,
        resultHash,
      });
    const status = readToolStatus(result.result);
    const resultKind = readResultKind(result.result);
    const artifactReference = {
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      artifactPath: "artifactPath" in locator ? locator.artifactPath : locator.absoluteDir,
    };
    const evidence = result.artifact
      ? result.artifact.evidence.map((entry) => ({
          key: entry.key,
          evidenceUri: entry.evidenceUri,
          kind: entry.kind,
          locator: entry.locator,
          display: entry.display,
          label: entry.label,
          ...artifactReference,
          source: entry.source,
          confidence: entry.confidence,
          modelSlots: entry.modelSlots,
        }))
      : [];
    const evidenceUris = evidence.map((item) => item.evidenceUri);
    const call: PlannerToolCallRecord = {
      step,
      toolName: result.name,
      argsHash,
      argumentsPreview: stringifyPreview(result.arguments),
      status,
      resultKind,
      ...artifactReference,
      evidenceUris,
      error: status === "Failure" ? readErrorMessage(result.result) : "",
    };

    ledger.calls.push(call);
    ledger.deltas.push({
      step,
      op: ExecutionDeltaOp.AddCall,
      toolName: result.name,
      argsHash,
      status,
      ...artifactReference,
      evidenceUris,
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
        ...artifactReference,
        evidenceUris: [entry.evidenceUri],
        note: entry.display,
      });
    }
  }
}

export function buildInitialActionPlannerLedger(
  _messages: readonly AgentLanguageModelMessage[] | undefined,
): AgentActionPlannerLedger {
  return cloneActionPlannerLedger(EmptyActionPlannerLedger);
}

export function cloneActionPlannerLedger(ledger: AgentActionPlannerLedger): AgentActionPlannerLedger {
  return {
    calls: [...ledger.calls],
    evidence: [...ledger.evidence],
    warnings: [...ledger.warnings],
    deltas: [...ledger.deltas],
    lastNewEvidenceStep: ledger.lastNewEvidenceStep,
  };
}

export function isActionPlannerLedgerStalled(
  currentStep: number,
  ledger: AgentActionPlannerLedger,
  options: {
    stalledStepLag: number;
  },
): boolean {
  if (ledger.calls.length === 0) {
    return false;
  }

  const firstCallStep = Math.min(...ledger.calls.map((call) => call.step));
  const progressAnchor = ledger.lastNewEvidenceStep > 0
    ? ledger.lastNewEvidenceStep
    : firstCallStep;
  return currentStep - progressAnchor >= options.stalledStepLag;
}

function collectRepeatedWarnings(
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

function readResultKind(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" ? kind.trim() : "";
}

function stableHash(value: unknown): string {
  return crypto
    .createHash("sha1")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}
