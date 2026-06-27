import type { PlannerEvidenceRecord } from "./AgentActionPlannerLedger.js";
import {
  compactObject,
  readArray,
  readRecord,
  stringifyPreview,
} from "./AgentActionPlannerProjectionUtils.js";

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
  return items.map(renderToolObservationItem).join("\n\n");
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
      lines.push(record
        ? `- ${String(record.kind ?? "")}: ${String(record.status ?? "")} ${String(record.summary ?? "")}`.trim()
        : `- ${stringifyPreview(entry)}`);
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
    return [`- ${stringifyPreview(value)}`];
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
      lines.push(slotRecord
        ? `  - ${String(slotRecord.name ?? "")}: ${String(slotRecord.value ?? "")}`
        : `  - ${stringifyPreview(slot)}`);
    }
  }

  return lines;
}

function renderOptionalLine(label: string, value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [`${label}: ${typeof value === "string" ? value : stringifyPreview(value)}`];
}
