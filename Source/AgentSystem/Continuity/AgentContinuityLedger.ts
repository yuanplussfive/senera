import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import type { ToolWorkspaceChange, ToolWorkspaceSnapshot } from "../Types/ToolRuntimeTypes.js";

/**
 * One append-only continuity surface for physical history, model summaries,
 * Artifacts, workspace checkpoints, and delegated work.  A reference is
 * intentionally small: the durable payload remains in its owning store and
 * can be dereferenced by URI when needed.
 */
export const AgentContinuityLedgerProtocol = defineSeneraProtocol("continuity_ledger", 1);
export const AgentContinuityLedgerCustomType = "senera.continuity_ledger";

export const AgentContinuityReferenceKinds = [
  "conversation",
  "artifact",
  "compaction",
  "learning",
  "workspace",
  "work_item",
] as const;
export type AgentContinuityReferenceKind = (typeof AgentContinuityReferenceKinds)[number];

export interface AgentContinuityReference {
  readonly id: string;
  readonly kind: AgentContinuityReferenceKind;
  readonly uri: string;
  readonly digest: string;
  readonly revision: string;
  readonly summary: string;
  readonly searchText?: string;
  readonly parentIds: readonly string[];
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentContinuityCheckpoint {
  readonly id: string;
  readonly revision: string;
  readonly capturedAt: string;
  readonly referenceIds: readonly string[];
  readonly parentCheckpointId?: string;
  readonly workItemId?: string;
  readonly workspaceRevision?: string;
  readonly resume: {
    readonly summaryUri?: string;
    readonly cursor?: string;
    readonly status?: string;
  };
}

/** Constraints used when a host resumes durable work without a model-supplied
 * checkpoint id. Omitted fields are intentionally unconstrained. */
export interface AgentContinuityCheckpointSelection {
  readonly workItemId?: string;
  readonly workspaceRevision?: string;
  readonly parentCheckpointId?: string;
  readonly resumeStatus?: string;
}

/** Durable identity for a workspace before/after pair. Inline file contents are
 * deliberately excluded; the Artifact owns those bytes and its manifest is
 * the dereference point. */
export interface AgentWorkspaceContinuityCheckpoint {
  readonly id: string;
  readonly baseRevision: string;
  readonly revision: string;
  readonly capturedAt: string;
  readonly changedPaths: readonly string[];
  readonly changeDigest: string;
  readonly artifactUri?: string;
}

export interface AgentContinuityLedger {
  readonly type: typeof AgentContinuityLedgerProtocol.type;
  readonly version: typeof AgentContinuityLedgerProtocol.version;
  readonly scope: string;
  readonly revision: string;
  readonly references: readonly AgentContinuityReference[];
  readonly checkpoints: readonly AgentContinuityCheckpoint[];
}

export interface CreateAgentContinuityReferenceInput {
  readonly kind: AgentContinuityReferenceKind;
  readonly uri: string;
  readonly revision?: string;
  readonly summary: string;
  readonly searchText?: string;
  readonly parentIds?: readonly string[];
  readonly createdAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly id?: string;
}

export interface CreateAgentContinuityCheckpointInput {
  readonly capturedAt?: string;
  readonly referenceIds: readonly string[];
  readonly parentCheckpointId?: string;
  readonly workItemId?: string;
  readonly workspaceRevision?: string;
  readonly resume?: AgentContinuityCheckpoint["resume"];
}

const NonBlankStringSchema = z.string().trim().min(1);
const ReferenceSchema = z
  .object({
    id: NonBlankStringSchema,
    kind: z.enum(AgentContinuityReferenceKinds),
    uri: NonBlankStringSchema,
    digest: NonBlankStringSchema,
    revision: NonBlankStringSchema,
    summary: NonBlankStringSchema,
    searchText: z.string().optional(),
    parentIds: z.array(NonBlankStringSchema),
    createdAt: NonBlankStringSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const AgentWorkspaceContinuityCheckpointSchema = z
  .object({
    id: NonBlankStringSchema,
    baseRevision: NonBlankStringSchema,
    revision: NonBlankStringSchema,
    capturedAt: NonBlankStringSchema,
    changedPaths: z.array(NonBlankStringSchema),
    changeDigest: NonBlankStringSchema,
    artifactUri: NonBlankStringSchema.optional(),
  })
  .strict();

const CheckpointSchema = z
  .object({
    id: NonBlankStringSchema,
    revision: NonBlankStringSchema,
    capturedAt: NonBlankStringSchema,
    referenceIds: z.array(NonBlankStringSchema),
    parentCheckpointId: NonBlankStringSchema.optional(),
    workItemId: NonBlankStringSchema.optional(),
    workspaceRevision: NonBlankStringSchema.optional(),
    resume: z
      .object({
        summaryUri: NonBlankStringSchema.optional(),
        cursor: NonBlankStringSchema.optional(),
        status: NonBlankStringSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const AgentContinuityCheckpointSchema = CheckpointSchema;

export const AgentContinuityLedgerSchema = z
  .object({
    type: z.literal(AgentContinuityLedgerProtocol.type),
    version: z.literal(AgentContinuityLedgerProtocol.version),
    scope: NonBlankStringSchema,
    revision: NonBlankStringSchema,
    references: z.array(ReferenceSchema),
    checkpoints: z.array(CheckpointSchema),
  })
  .strict();

export function createAgentContinuityReference(input: CreateAgentContinuityReferenceInput): AgentContinuityReference {
  const uri = requireText(input.uri, "Continuity reference URI");
  const summary = requireText(input.summary, "Continuity reference summary");
  const searchText = input.searchText?.trim();
  const parentIds = uniqueStrings(input.parentIds ?? []);
  const revision = requireText(input.revision ?? "1", "Continuity reference revision");
  const digest = sha256HexOfCanonicalJson({
    kind: input.kind,
    uri,
    revision,
    summary,
    ...(searchText ? { searchText } : {}),
    parentIds,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  return {
    id: input.id?.trim() || `${input.kind}:${digest.slice(0, 24)}`,
    kind: input.kind,
    uri,
    digest,
    revision,
    summary,
    ...(searchText ? { searchText } : {}),
    parentIds,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function createAgentContinuityCheckpoint(
  input: CreateAgentContinuityCheckpointInput,
): AgentContinuityCheckpoint {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const referenceIds = uniqueStrings(input.referenceIds);
  if (referenceIds.length === 0) throw new Error("Continuity checkpoints require at least one reference.");
  const parentCheckpointId = input.parentCheckpointId?.trim();
  const workItemId = input.workItemId?.trim();
  const workspaceRevision = input.workspaceRevision?.trim();
  const resume = {
    ...(input.resume?.summaryUri?.trim() ? { summaryUri: input.resume.summaryUri.trim() } : {}),
    ...(input.resume?.cursor?.trim() ? { cursor: input.resume.cursor.trim() } : {}),
    ...(input.resume?.status?.trim() ? { status: input.resume.status.trim() } : {}),
  } satisfies AgentContinuityCheckpoint["resume"];
  const revision = sha256HexOfCanonicalJson({
    capturedAt,
    referenceIds,
    ...(parentCheckpointId ? { parentCheckpointId } : {}),
    ...(workItemId ? { workItemId } : {}),
    ...(workspaceRevision ? { workspaceRevision } : {}),
    resume,
  });
  return {
    id: `checkpoint:${revision.slice(0, 24)}`,
    revision,
    capturedAt,
    referenceIds,
    ...(parentCheckpointId ? { parentCheckpointId } : {}),
    ...(workItemId ? { workItemId } : {}),
    ...(workspaceRevision ? { workspaceRevision } : {}),
    resume,
  };
}

export function createAgentWorkspaceContinuityCheckpoint(input: {
  readonly before: ToolWorkspaceSnapshot;
  readonly after: ToolWorkspaceSnapshot;
  readonly changes: readonly ToolWorkspaceChange[];
  readonly artifactUri?: string;
}): AgentWorkspaceContinuityCheckpoint {
  const baseRevision = workspaceSnapshotRevision(input.before);
  const revision = workspaceSnapshotRevision(input.after);
  const changedPaths = [
    ...new Set(input.changes.filter((change) => change.status !== "unchanged").map((change) => change.path)),
  ].sort();
  const changeDigest = sha256HexOfCanonicalJson(
    input.changes.map((change) => ({
      path: change.path,
      status: change.status,
      beforeHash: change.beforeHash,
      afterHash: change.afterHash,
    })),
  );
  return {
    id: `workspace:${revision.slice(0, 24)}`,
    baseRevision,
    revision,
    capturedAt: input.after.capturedAt,
    changedPaths,
    changeDigest,
    ...(input.artifactUri ? { artifactUri: input.artifactUri } : {}),
  };
}

export function workspaceSnapshotRevision(snapshot: ToolWorkspaceSnapshot): string {
  return sha256HexOfCanonicalJson(
    snapshot.files
      .map((file) => ({
        path: file.path,
        exists: file.exists,
        kind: file.kind,
        size: file.size,
        hash: file.hash,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
}

export function createAgentContinuityLedger(input: {
  readonly scope: string;
  readonly references?: readonly AgentContinuityReference[];
  readonly checkpoints?: readonly AgentContinuityCheckpoint[];
}): AgentContinuityLedger {
  return mergeAgentContinuityLedger(undefined, input.scope, input.references ?? [], input.checkpoints ?? []);
}

/** Merges append-only updates without duplicating a source or checkpoint. */
export function mergeAgentContinuityLedger(
  previous: AgentContinuityLedger | undefined,
  scope: string,
  references: readonly AgentContinuityReference[] = [],
  checkpoints: readonly AgentContinuityCheckpoint[] = [],
): AgentContinuityLedger {
  const referenceMap = new Map<string, AgentContinuityReference>();
  for (const reference of previous?.references ?? []) referenceMap.set(reference.id, reference);
  for (const reference of references) referenceMap.set(reference.id, reference);
  const checkpointMap = new Map<string, AgentContinuityCheckpoint>();
  for (const checkpoint of previous?.checkpoints ?? []) checkpointMap.set(checkpoint.id, checkpoint);
  for (const checkpoint of checkpoints) checkpointMap.set(checkpoint.id, checkpoint);
  const normalizedScope = requireText(scope, "Continuity ledger scope");
  const normalizedReferences = [...referenceMap.values()].sort(compareReferences);
  const normalizedCheckpoints = [...checkpointMap.values()].sort(compareCheckpoints);
  const revision = sha256HexOfCanonicalJson({
    scope: normalizedScope,
    references: normalizedReferences,
    checkpoints: normalizedCheckpoints,
  });
  return {
    type: AgentContinuityLedgerProtocol.type,
    version: AgentContinuityLedgerProtocol.version,
    scope: normalizedScope,
    revision,
    references: normalizedReferences,
    checkpoints: normalizedCheckpoints,
  };
}

export function readAgentContinuityLedger(value: unknown): AgentContinuityLedger | undefined {
  const parsed = AgentContinuityLedgerSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Selects the newest compatible checkpoint deterministically. Checkpoint
 * identity is still available for explicit recovery, but callers that only
 * know the durable work scope no longer need to guess by array position.
 */
export function selectAgentContinuityCheckpoint(
  checkpoints: readonly AgentContinuityCheckpoint[],
  selection: AgentContinuityCheckpointSelection = {},
): AgentContinuityCheckpoint | undefined {
  const workItemId = normalizeOptionalSelection(selection.workItemId);
  const workspaceRevision = normalizeOptionalSelection(selection.workspaceRevision);
  const parentCheckpointId = normalizeOptionalSelection(selection.parentCheckpointId);
  const resumeStatus = normalizeOptionalSelection(selection.resumeStatus);
  return [...checkpoints]
    .filter((checkpoint) => !workItemId || checkpoint.workItemId === workItemId)
    .filter((checkpoint) => !workspaceRevision || checkpoint.workspaceRevision === workspaceRevision)
    .filter((checkpoint) => !parentCheckpointId || checkpoint.parentCheckpointId === parentCheckpointId)
    .filter((checkpoint) => !resumeStatus || checkpoint.resume.status === resumeStatus)
    .sort(compareCheckpointsNewestFirst)[0];
}

export interface AgentContinuityLedgerSearchResult {
  readonly reference: AgentContinuityReference;
  readonly score: number;
}

/** Deterministic lexical recall over all continuity sources. */
export function searchAgentContinuityLedger(
  ledger: AgentContinuityLedger,
  query: string,
  limit = ledger.references.length,
): readonly AgentContinuityLedgerSearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  return ledger.references
    .map((reference) => {
      const haystack = tokenize(
        [reference.uri, reference.summary, reference.searchText ?? "", ...reference.parentIds].join(" "),
      );
      const matched = terms.filter((term) => haystack.includes(term)).length;
      const score = matched / terms.length;
      return { reference, score } satisfies AgentContinuityLedgerSearchResult;
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || compareReferences(left.reference, right.reference))
    .slice(0, Math.max(0, Math.floor(limit)));
}

function compareReferences(left: AgentContinuityReference, right: AgentContinuityReference): number {
  return left.kind.localeCompare(right.kind) || left.uri.localeCompare(right.uri) || left.id.localeCompare(right.id);
}

function compareCheckpoints(left: AgentContinuityCheckpoint, right: AgentContinuityCheckpoint): number {
  return compareTimestamp(left.capturedAt, right.capturedAt) || left.id.localeCompare(right.id);
}

function compareCheckpointsNewestFirst(left: AgentContinuityCheckpoint, right: AgentContinuityCheckpoint): number {
  return compareTimestamp(right.capturedAt, left.capturedAt) || right.id.localeCompare(left.id);
}

function normalizeOptionalSelection(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function compareTimestamp(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
  return left.localeCompare(right);
}

function tokenize(value: string): readonly string[] {
  // Ledger recall participates in cache keys and cross-process recovery; use
  // locale-independent case folding so the same ledger behaves identically on
  // hosts with different system locales.
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (!normalized) return [];
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const compact = normalized.replace(/\s+/gu, "");
  const cjk = [...compact].filter((char) => /[\u3400-\u9fff]/u.test(char));
  return uniqueStrings([...words, ...cjk]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
