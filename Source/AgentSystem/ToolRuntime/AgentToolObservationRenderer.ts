import type { PlannerEvidenceRecord } from "../ActionPlanner/AgentActionPlannerLedger.js";
import {
  compactObject,
  readArray,
  readRecord,
  stringifyPreview,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { previewAgentText } from "../Text/AgentTextProjection.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { selectJsonValues } from "../Artifacts/AgentArtifactJsonSelector.js";
import type { ToolObservationContinuationManifest, ToolObservationManifest } from "../Types/PluginManifestTypes.js";

const ToolObservationTextLimits = {
  lineValueChars: 2_000,
  itemChars: 8_000,
  jsonStringChars: 2_000,
  jsonArrayItems: 24,
  jsonObjectFields: 48,
} as const;

const ToolObservationTokenLimits = {
  lineValueTokens: 500,
  jsonStringTokens: 500,
  projectionTokens: 4_000,
  resultTokens: 4_000,
  maxConfiguredResultTokens: 12_000,
} as const;

export interface AgentToolObservationRenderOptions {
  model?: string;
  observation?: ToolObservationManifest;
}

export function projectLedgerEvidenceForTimeline(record: PlannerEvidenceRecord): Record<string, unknown> {
  return compactObject({
    evidenceUri: record.evidenceUri,
    kind: record.kind,
    locator: record.locator,
    display: record.display,
    label: record.label,
    source: record.source,
    confidence: record.confidence,
    artifactUri: record.artifactUri,
    slots: record.modelSlots,
  });
}

export function renderToolObservationContent(items: readonly Record<string, unknown>[]): string {
  return items
    .map(renderToolObservationItem)
    .map((item) => previewAgentText(item, ToolObservationTextLimits.itemChars))
    .join("\n\n");
}

export function renderOpenAiToolObservationContent(
  item: Record<string, unknown>,
  options: AgentToolObservationRenderOptions = {},
): string {
  return JSON.stringify(projectOpenAiToolObservation(item, createProjectionContext(options), options.observation));
}

export function projectOpenAiToolObservation(
  item: Record<string, unknown>,
  context: AgentToolObservationProjectionContext = createProjectionContext(),
  observationPolicy?: ToolObservationManifest,
): Record<string, unknown> {
  const artifact = readRecord(item.artifact);
  const structuredSummary = readRecord(artifact?.structuredSummary);
  const evidence = readArray(item.evidence ?? artifact?.evidence);
  const response = readRecord(item.response);
  return compactObject({
    type: "senera.tool_observation.v1",
    tool_name: item.name,
    call_id: item.callId,
    status: readObservationStatus(item, response),
    arguments: projectOpenAiObservationValueWithContext(item.arguments, context),
    result: projectOpenAiResult(item.result, context, observationPolicy),
    continuation: projectOpenAiContinuation(item.result, observationPolicy?.Continuation),
    headline: projectOpenAiObservationValueWithContext(structuredSummary?.headline, context),
    summary: projectOpenAiObservationValueWithContext(structuredSummary?.summary ?? artifact?.summary, context),
    projection:
      observationPolicy?.IncludeArtifactProjection === false
        ? undefined
        : projectOpenAiProjection(artifact?.projection, context),
    summary_facts: projectOpenAiObservationValueWithContext(structuredSummary?.facts, context),
    limitations: projectOpenAiObservationValueWithContext(structuredSummary?.limitations, context),
    retrieval: projectOpenAiObservationValueWithContext(structuredSummary?.retrieval, context),
    error: projectOpenAiObservationValueWithContext(item.error ?? response?.error, context),
    artifact_uri: item.artifactUri ?? artifact?.artifactUri,
    evidence: evidence.map(projectOpenAiEvidence),
    delta: readArray(artifact?.delta).map(projectOpenAiDelta),
    workspace: projectOpenAiObservationValueWithContext(artifact?.workspace, context),
  });
}

function projectOpenAiResult(
  value: unknown,
  context: AgentToolObservationProjectionContext,
  policy: ToolObservationManifest | undefined,
): unknown {
  if (value === undefined) {
    return undefined;
  }
  const configured = policy?.MaxTokens ?? ToolObservationTokenLimits.resultTokens;
  const tokenLimit = Math.min(
    ToolObservationTokenLimits.maxConfiguredResultTokens,
    Math.max(1, Math.floor(configured)),
  );
  return context.tokenProjector
    ? context.tokenProjector.previewJson(value, tokenLimit)
    : projectOpenAiObservationValueWithContext(value, context);
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

function projectOpenAiProjection(value: unknown, context: AgentToolObservationProjectionContext): unknown {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return previewProjectionText(value, {
    chars: ToolObservationTextLimits.itemChars,
    tokens: ToolObservationTokenLimits.projectionTokens,
    context,
  });
}

function readObservationStatus(item: Record<string, unknown>, response: Record<string, unknown> | undefined): string {
  if (item.error || response?.error) {
    return "failure";
  }
  if (response?.ok === false) {
    return "failure";
  }
  if (response?.ok === true || item.result || item.artifact) {
    return "success";
  }
  return String(item.status ?? "");
}

function projectOpenAiObservationValue(value: unknown, depth = 0): unknown {
  return projectOpenAiObservationValueWithContext(value, createProjectionContext(), depth);
}

interface AgentToolObservationProjectionContext {
  tokenProjector?: AgentTokenProjector;
}

function createProjectionContext(
  options: AgentToolObservationRenderOptions = {},
): AgentToolObservationProjectionContext {
  return {
    tokenProjector: options.model ? new AgentTokenProjector(options.model) : undefined,
  };
}

function projectOpenAiObservationValueWithContext(
  value: unknown,
  context: AgentToolObservationProjectionContext,
  depth = 0,
): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return previewProjectionText(value, {
      chars: ToolObservationTextLimits.jsonStringChars,
      tokens: ToolObservationTokenLimits.jsonStringTokens,
      context,
    });
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (depth >= 4) {
    return previewProjectionText(stringifyPreview(value), {
      chars: ToolObservationTextLimits.jsonStringChars,
      tokens: ToolObservationTokenLimits.jsonStringTokens,
      context,
    });
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, ToolObservationTextLimits.jsonArrayItems)
      .map((entry) => projectOpenAiObservationValueWithContext(entry, context, depth + 1));
  }
  const record = readRecord(value);
  if (!record) {
    return previewProjectionText(stringifyPreview(value), {
      chars: ToolObservationTextLimits.jsonStringChars,
      tokens: ToolObservationTokenLimits.jsonStringTokens,
      context,
    });
  }
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, ToolObservationTextLimits.jsonObjectFields)
      .flatMap(([key, entry]) => {
        const projected = projectOpenAiObservationValueWithContext(entry, context, depth + 1);
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
  const text = typeof value === "string" ? value : stringifyPreview(value);
  return previewAgentText(text, ToolObservationTextLimits.lineValueChars);
}

function previewProjectionText(
  input: string,
  options: {
    chars: number;
    tokens: number;
    context: AgentToolObservationProjectionContext;
  },
): string {
  return options.context.tokenProjector
    ? options.context.tokenProjector.previewText(input, options.tokens).text
    : previewAgentText(input, options.chars);
}
