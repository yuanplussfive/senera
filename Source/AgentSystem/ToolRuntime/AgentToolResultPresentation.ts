import {
  AgentToolResultPresentationProtocol,
  type AgentToolResultPresentation,
  type AgentToolResultPresentationChange,
  type AgentToolResultPresentationEvidence,
  type AgentToolResultPresentationFact,
  type AgentToolResultPresentationWorkspaceObservation,
  type ExecutedToolCallResult,
  type ToolWorkspaceFileSnapshot,
} from "../Types/ToolRuntimeTypes.js";
import { readAgentUnknownRecord as readRecord } from "../Core/AgentUnknownValue.js";
import { projectAgentExecutedToolResultStatus, readAgentToolFailure } from "./AgentToolResultOutcome.js";
import { projectAgentModelText } from "../Text/AgentModelPayloadProjection.js";
import { normalizeAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { AgentResourceReferenceOrigins, type AgentResourceReference } from "../Resources/AgentResourceReference.js";
import { isWorkspaceDirectoryChange, isWorkspaceFileChange } from "../Artifacts/AgentWorkspaceSnapshotDiff.js";

/**
 * Separates the model's complete tool observation from the compact, human
 * readable result surface. Tool evidence owns the display wording.
 */
export function projectAgentToolResultPresentation(result: ExecutedToolCallResult): AgentToolResultPresentation {
  const status = projectAgentExecutedToolResultStatus(result);
  const evidence = projectEvidence(result);
  const changes = projectChanges(result);
  const facts = projectFacts(result);
  const rawFailure = readAgentToolFailure(result.outcome);
  const failure = rawFailure ? { ...rawFailure, message: projectPresentationText(rawFailure.message) } : undefined;
  const semanticText = readResultText(result.result);
  const headline = failure?.message ?? evidence[0]?.display ?? changes[0]?.summary ?? semanticText ?? "";
  const summary = buildSummary(evidence, changes, semanticText, headline);
  const workspaceCheckpoint = result.artifact?.workspace?.checkpoint ?? result.workspaceCapture?.checkpoint;
  const workspaceObservation = projectWorkspaceObservation(result);
  const resources = projectResources(result);

  return {
    type: AgentToolResultPresentationProtocol.type,
    version: AgentToolResultPresentationProtocol.version,
    status,
    headline,
    summary,
    facts,
    evidence,
    changes,
    ...(resources.length > 0 ? { resources } : {}),
    artifactUri: result.artifact?.artifactUri,
    ...(workspaceObservation ? { workspaceObservation } : {}),
    ...(workspaceCheckpoint ? { workspaceCheckpoint } : {}),
    ...(result.artifactAvailability ? { artifactAvailability: result.artifactAvailability } : {}),
    failure,
  };
}

function projectWorkspaceObservation(
  result: ExecutedToolCallResult,
): AgentToolResultPresentationWorkspaceObservation | undefined {
  const workspace = result.artifact?.workspace ?? result.workspaceCapture;
  if (!workspace) return undefined;

  // Older Artifact snapshots can still contain scanner diagnostics. New
  // receipt-based ChangeSets never produce them, but replay must remain able
  // to describe the historical observation accurately.
  const legacyWarnings = uniqueText([...(workspace.before.warnings ?? []), ...(workspace.after.warnings ?? [])]);
  const changedFileCount = workspace.changes.filter(
    (change) => change.status !== "unchanged" && isWorkspaceFileChange(change),
  ).length;
  const changedDirectoryCount = workspace.changes.filter(
    (change) => change.status !== "unchanged" && isWorkspaceDirectoryChange(change),
  ).length;
  const quality = workspace.status;
  const hasObservedCoverage = workspace.coverage === "observed";
  if (
    changedFileCount === 0 &&
    changedDirectoryCount === 0 &&
    legacyWarnings.length === 0 &&
    quality !== "degraded" &&
    !hasObservedCoverage
  ) {
    return undefined;
  }
  return {
    status: legacyWarnings.length > 0 || quality === "degraded" ? "partial" : "complete",
    ...(quality ? { quality } : {}),
    ...(workspace.source ? { source: workspace.source } : {}),
    ...(workspace.sources ? { sources: workspace.sources } : {}),
    ...(workspace.coverage ? { coverage: workspace.coverage } : {}),
    ...(workspace.scope ? { scope: workspace.scope } : {}),
    beforeEntryCount: workspace.before.files.length,
    afterEntryCount: workspace.after.files.length,
    changedFileCount,
    changedDirectoryCount,
    warningCount: legacyWarnings.length,
    ...(legacyWarnings.length > 0 ? { warnings: legacyWarnings.slice(0, 4) } : {}),
  };
}

function projectResources(result: ExecutedToolCallResult): AgentResourceReference[] {
  const resources = new Map<string, AgentResourceReference>();
  for (const asset of result.artifact?.assets ?? []) {
    const reference = createResourceReference(
      asset.resourceUri,
      asset.fileName,
      asset.mediaType,
      AgentResourceReferenceOrigins.Artifact,
    );
    if (!reference) continue;
    addResourceReference(resources, {
      ...reference,
      size: asset.byteLength,
      sha256: asset.sha256,
    });
  }

  for (const evidence of result.artifact?.evidence ?? []) {
    const metadata = readRecord(evidence.metadata);
    if (metadata?.contentType !== "resource") continue;
    const resourceUri =
      typeof metadata.resourceUri === "string"
        ? metadata.resourceUri
        : typeof evidence.locator === "string"
          ? evidence.locator
          : undefined;
    const reference = createResourceReference(
      resourceUri,
      metadata.name ?? evidence.display,
      metadata.mimeType,
      AgentResourceReferenceOrigins.Tool,
    );
    addResourceReference(resources, withResourceMetadata(reference, metadata.size, metadata.sha256));
  }

  const resultRecord = readRecord(result.result);
  const content = resultRecord && Array.isArray(resultRecord.content) ? resultRecord.content : [];
  for (const item of content) {
    const record = readRecord(item);
    if (record?.type !== "resource" && record?.type !== "resource_link") continue;
    addResourceReference(resources, readContentResourceReference(record));
  }

  const declaredResources = resultRecord && Array.isArray(resultRecord.resources) ? resultRecord.resources : [];
  for (const value of declaredResources) {
    addResourceReference(resources, readDeclaredResourceReference(value));
  }

  return [...resources.values()];
}

function addResourceReference(
  resources: Map<string, AgentResourceReference>,
  reference: AgentResourceReference | undefined,
): void {
  if (!reference) return;
  const previous = resources.get(reference.uri);
  if (!previous) {
    resources.set(reference.uri, reference);
    return;
  }

  const preferredOrigin =
    previous.origin === AgentResourceReferenceOrigins.Artifact ||
    reference.origin === AgentResourceReferenceOrigins.Artifact
      ? AgentResourceReferenceOrigins.Artifact
      : reference.origin;
  resources.set(reference.uri, {
    ...previous,
    ...reference,
    origin: preferredOrigin,
    name: preferResourceName(previous, reference),
    mime: preferResourceMime(previous, reference),
    ...(reference.size === undefined && previous.size !== undefined ? { size: previous.size } : {}),
    ...(reference.sha256 === undefined && previous.sha256 !== undefined ? { sha256: previous.sha256 } : {}),
  });
}

function preferResourceName(previous: AgentResourceReference, next: AgentResourceReference): string {
  return previous.name === previous.uri ? next.name : previous.name;
}

function preferResourceMime(previous: AgentResourceReference, next: AgentResourceReference): string {
  return previous.mime === "application/octet-stream" ? next.mime : previous.mime;
}

function readContentResourceReference(value: Record<string, unknown>): AgentResourceReference | undefined {
  const resource = readRecord(value.resource);
  const rawUri =
    typeof value.uri === "string" ? value.uri : typeof resource?.uri === "string" ? resource.uri : undefined;
  const nameValue = typeof value.name === "string" ? value.name : resource?.name;
  const mimeValue = typeof value.mimeType === "string" ? value.mimeType : resource?.mimeType;
  return withResourceMetadata(
    createResourceReference(rawUri, nameValue, mimeValue),
    value.size ?? resource?.size,
    value.sha256 ?? resource?.sha256,
  );
}

function readDeclaredResourceReference(value: unknown): AgentResourceReference | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const rawUri =
    typeof record.resourceUri === "string"
      ? record.resourceUri
      : typeof record.uri === "string"
        ? record.uri
        : undefined;
  const reference = createResourceReference(rawUri, record.name, record.mime ?? record.mimeType ?? record.mediaType);
  return withResourceMetadata(reference, record.size, record.sha256);
}

function withResourceMetadata(
  reference: AgentResourceReference | undefined,
  rawSize: unknown,
  rawSha256: unknown,
): AgentResourceReference | undefined {
  if (!reference) return undefined;
  return {
    ...reference,
    ...(typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0 ? { size: rawSize } : {}),
    ...(typeof rawSha256 === "string" && rawSha256.trim() ? { sha256: rawSha256.trim() } : {}),
  };
}

function createResourceReference(
  rawUri: unknown,
  rawName: unknown,
  rawMime: unknown,
  origin: AgentResourceReference["origin"] = AgentResourceReferenceOrigins.Tool,
): AgentResourceReference | undefined {
  const uri = typeof rawUri === "string" ? normalizeAgentResourceUri(rawUri) : undefined;
  if (!uri) return undefined;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : uri;
  const mime = typeof rawMime === "string" && rawMime.trim() ? rawMime.trim() : "application/octet-stream";
  return { uri, name, mime, origin };
}

function projectEvidence(result: ExecutedToolCallResult): AgentToolResultPresentationEvidence[] {
  const seen = new Set<string>();
  return (result.artifact?.evidence ?? []).flatMap((entry) => {
    const key = entry.evidenceUri || entry.key;
    if (!key || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [
      {
        evidenceUri: entry.evidenceUri,
        kind: entry.kind,
        display: projectPresentationText(entry.display),
        label: projectPresentationText(entry.label),
        source: projectPresentationText(entry.source),
        locator: projectPresentationText(entry.locator),
        confidence: entry.confidence,
      },
    ];
  });
}

function projectFacts(result: ExecutedToolCallResult): AgentToolResultPresentationFact[] {
  const summaryFacts = result.artifact?.structuredSummary?.facts ?? [];
  const fallbackFacts =
    result.artifact?.evidence.flatMap((entry) =>
      entry.modelSlots.map((slot) => ({
        name: slot.name,
        value: slot.value,
        kind: entry.kind,
        evidenceUri: entry.evidenceUri,
        confidence: entry.confidence,
      })),
    ) ?? [];
  const facts =
    summaryFacts.length > 0
      ? summaryFacts.map((fact) => ({
          name: fact.name,
          value: fact.value,
          kind: fact.kind,
          evidenceUri: fact.evidenceUri,
          confidence: fact.confidence,
        }))
      : fallbackFacts;
  const seen = new Set<string>();
  return facts.flatMap((fact) => {
    const name = projectPresentationText(fact.name);
    const value = projectPresentationText(fact.value);
    const key = `${name}\u0000${value}\u0000${fact.evidenceUri ?? ""}`;
    if (!name || !value || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ ...fact, name, value }];
  });
}

function projectChanges(result: ExecutedToolCallResult): AgentToolResultPresentationChange[] {
  const workspaceChanges = new Map(
    (result.artifact?.workspace ?? result.workspaceCapture)?.changes.map((change) => [change.path, change]) ?? [],
  );
  // The executor publishes a lifecycle completion before Artifact recording
  // finishes. Keep that fast event useful by projecting the capture directly;
  // the later Artifact delta is merged through the same identity below.
  const workspaceDeltas = [...workspaceChanges.values()]
    .filter((change) => change.status !== "unchanged")
    .map((change) => ({
      kind: "workspace",
      status: "changed" as const,
      key: change.path,
      summary: `${change.status}: ${change.path}`,
    }));
  const changes = [...(result.artifact?.delta ?? []), ...workspaceDeltas];
  const seen = new Set<string>();
  return changes.flatMap((change) => {
    const key = `${change.kind}\u0000${change.status}\u0000${change.key}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    const workspaceChange = change.kind === "workspace" ? workspaceChanges.get(change.key) : undefined;
    const metadata = "metadata" in change ? readRecord(change.metadata) : undefined;
    const workspaceBeforeKind = readWorkspaceKind(workspaceChange?.beforeKind ?? metadata?.beforeKind);
    const workspaceAfterKind = readWorkspaceKind(workspaceChange?.afterKind ?? metadata?.afterKind);
    return [
      {
        kind: change.kind,
        status: change.status,
        key: projectPresentationText(change.key),
        summary: projectPresentationText(change.summary),
        ...(workspaceChange ? { workspaceStatus: workspaceChange.status } : {}),
        ...(workspaceBeforeKind ? { workspaceBeforeKind } : {}),
        ...(workspaceAfterKind ? { workspaceAfterKind } : {}),
        addedLines: workspaceChange?.addedLines,
        removedLines: workspaceChange?.removedLines,
      },
    ];
  });
}

const WorkspaceSnapshotKinds = new Set<ToolWorkspaceFileSnapshot["kind"]>([
  "file",
  "directory",
  "missing",
  "other",
  "symlink",
]);

function readWorkspaceKind(value: unknown): ToolWorkspaceFileSnapshot["kind"] | undefined {
  return typeof value === "string" && WorkspaceSnapshotKinds.has(value as ToolWorkspaceFileSnapshot["kind"])
    ? (value as ToolWorkspaceFileSnapshot["kind"])
    : undefined;
}

function buildSummary(
  evidence: readonly AgentToolResultPresentationEvidence[],
  changes: readonly AgentToolResultPresentationChange[],
  semanticText: string | undefined,
  headline: string,
): string | undefined {
  const details = uniqueText([
    ...evidence.map((entry) => entry.display),
    ...changes.map((entry) => entry.summary),
    semanticText,
  ]).filter((text) => text !== headline);
  return details.length > 0 ? details.join("\n") : undefined;
}

function readResultText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeText(projectAgentModelText(value).text);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  const record = readRecord(value);
  return record ? readSemanticText(record) : undefined;
}

function readSemanticText(value: Record<string, unknown>): string | undefined {
  const candidates = [value.headline, value.summary, value.message, value.text, value.output];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const text = normalizeText(projectAgentModelText(candidate).text);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function normalizeText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function projectPresentationText(value: string): string {
  return normalizeText(projectAgentModelText(value).text) ?? "";
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}
