import {
  compactObject,
  readArray,
  readRecord,
  stringifyPreview,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { selectJsonValues } from "../Artifacts/AgentArtifactJsonSelector.js";
import type { ToolObservationContinuationManifest, ToolObservationManifest } from "../Types/AgentToolContractTypes.js";
import { createAgentPiToolObservation } from "../Pi/AgentPiToolObservation.js";

export function renderToolObservationContent(items: readonly Record<string, unknown>[]): string {
  return items.map(renderToolObservationItem).join("\n\n");
}

export function renderOpenAiToolObservationContent(
  item: Record<string, unknown>,
  observationPolicy?: ToolObservationManifest,
): string {
  return JSON.stringify(projectOpenAiToolObservation(item, observationPolicy));
}

export function projectOpenAiToolObservation(
  item: Record<string, unknown>,
  observationPolicy?: ToolObservationManifest,
): Record<string, unknown> {
  const artifact = readRecord(item.artifact);
  const structuredSummary = readRecord(artifact?.structuredSummary);
  const evidence = readArray(item.evidence ?? artifact?.evidence);
  return createAgentPiToolObservation(
    compactObject({
      tool_name: item.name,
      call_id: item.callId,
      batch_id: item.batchId,
      status: item.status,
      execution_status: item.execution_status,
      output_availability: item.output_availability,
      outcome: projectOpenAiObservationValue(item.outcome),
      process: projectOpenAiObservationValue(item.process),
      headline: projectOpenAiObservationValue(structuredSummary?.headline),
      summary: projectOpenAiObservationValue(structuredSummary?.summary ?? artifact?.summary),
      error: projectOpenAiObservationValue(item.error),
      artifact_uri: item.artifactUri ?? artifact?.artifactUri,
      retrieval: projectOpenAiObservationValue(structuredSummary?.retrieval),
      continuation: projectOpenAiContinuation(item.result, observationPolicy?.Continuation),
      result: projectOpenAiResult(item.result),
      arguments: projectOpenAiObservationValue(item.arguments),
      projection:
        observationPolicy?.IncludeArtifactProjection === false
          ? undefined
          : projectOpenAiProjection(artifact?.projection),
      summary_facts: projectOpenAiObservationValue(structuredSummary?.facts),
      limitations: projectOpenAiObservationValue(structuredSummary?.limitations),
      evidence: evidence.map(projectOpenAiEvidence),
      delta: readArray(artifact?.delta).map(projectOpenAiDelta),
      workspace: projectOpenAiObservationValue(artifact?.workspace),
    }),
  );
}

function projectOpenAiResult(value: unknown): unknown {
  return value === undefined ? undefined : projectOpenAiObservationValue(value);
}

function projectOpenAiContinuation(
  result: unknown,
  policy: ToolObservationContinuationManifest | undefined,
): Record<string, unknown> | undefined {
  if (!policy) {
    return undefined;
  }
  const handle = readContinuationValue(result, policy.Handle);
  if (handle === undefined) {
    return undefined;
  }
  const state = policy.State ? readContinuationValue(result, policy.State) : undefined;
  return compactObject({
    kind: policy.Kind,
    handle,
    cursor: policy.Cursor ? readContinuationValue(result, policy.Cursor) : undefined,
    state,
    terminal:
      state === undefined || !policy.TerminalStates
        ? undefined
        : policy.TerminalStates.some((terminalState) => terminalState === String(state)),
  });
}

function readContinuationValue(root: unknown, selector: string): string | number | boolean | undefined {
  const value = selectJsonValues(root, selector).at(0);
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function renderToolObservationItem(item: Record<string, unknown>): string {
  const artifact = readRecord(item.artifact);
  const evidence = readArray(item.evidence ?? artifact?.evidence);
  const lines = [
    `tool: ${String(item.name ?? "")}`,
    `status: ${String(item.status ?? readRecord(item.response)?.ok ?? "")}`,
    ...renderOptionalLine("artifactUri", item.artifactUri ?? artifact?.artifactUri),
    ...renderOptionalLine("summary", artifact?.summary),
    ...renderOptionalLine("error", item.error ?? readRecord(item.response)?.error),
  ];

  if (evidence.length > 0) {
    lines.push("evidence:");
    for (const entry of evidence) {
      lines.push(...renderEvidenceBlock(entry));
    }
  }

  const delta = readArray(artifact?.delta);
  if (delta.length > 0) {
    lines.push("delta:");
    for (const entry of delta) {
      const record = readRecord(entry);
      lines.push(
        record
          ? `- ${String(record.kind ?? "")}: ${String(record.status ?? "")} ${String(record.summary ?? "")}`.trim()
          : `- ${stringifyPreview(entry)}`,
      );
    }
  }

  if (lines.length === 0) {
    return stringifyPreview(item);
  }

  return lines.filter((line) => line.trim().length > 0).join("\n");
}

function renderEvidenceBlock(value: unknown): string[] {
  const record = readRecord(value);
  if (!record) {
    return [`- ${previewObservationValue(value)}`];
  }

  const lines = [
    `- evidenceUri: ${String(record.evidenceUri ?? "")}`,
    ...renderOptionalLine("  kind", record.kind),
    ...renderOptionalLine("  locator", record.locator),
    ...renderOptionalLine("  display", record.display),
    ...renderOptionalLine("  source", record.source),
    ...renderOptionalLine("  confidence", record.confidence),
  ];
  const slots = readArray(record.slots);
  if (slots.length > 0) {
    lines.push("  slots:");
    for (const slot of slots) {
      const slotRecord = readRecord(slot);
      lines.push(
        slotRecord
          ? `  - ${String(slotRecord.name ?? "")}: ${previewObservationValue(slotRecord.value)}`
          : `  - ${previewObservationValue(slot)}`,
      );
    }
  }

  return lines;
}

function projectOpenAiEvidence(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) {
    return projectOpenAiObservationValue(value);
  }

  const plannerMemory = readRecord(record.plannerMemory);
  return compactObject({
    evidence_uri: record.evidenceUri,
    kind: record.kind,
    locator: projectOpenAiObservationValue(record.locator),
    display: projectOpenAiObservationValue(record.display),
    label: projectOpenAiObservationValue(record.label),
    source: projectOpenAiObservationValue(record.source),
    confidence: record.confidence,
    artifact_uri: plannerMemory?.artifactUri,
    artifact_refs: projectOpenAiObservationValue(plannerMemory?.artifactRefs),
    facts: readArray(record.slots).map((slot) => {
      const slotRecord = readRecord(slot);
      return slotRecord
        ? compactObject({
            name: slotRecord.name,
            value: projectOpenAiObservationValue(slotRecord.value),
          })
        : projectOpenAiObservationValue(slot);
    }),
  });
}

function projectOpenAiDelta(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) {
    return projectOpenAiObservationValue(value);
  }

  return compactObject({
    kind: record.kind,
    status: record.status,
    summary: projectOpenAiObservationValue(record.summary),
  });
}

function projectOpenAiProjection(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return projectOpenAiObservationValue(value);
}

function projectOpenAiObservationValue(value: unknown): unknown {
  return projectOpenAiObservationValueWithContext(value);
}

function projectOpenAiObservationValueWithContext(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => projectOpenAiObservationValueWithContext(entry));
  }
  const record = readRecord(value);
  if (!record) {
    return stringifyPreview(value);
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const projected = projectOpenAiObservationValueWithContext(entry);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function renderOptionalLine(label: string, value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [`${label}: ${previewObservationValue(value)}`];
}

function previewObservationValue(value: unknown): string {
  return typeof value === "string" ? value : stringifyPreview(value);
}
