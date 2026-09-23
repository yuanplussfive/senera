import { createCompactionSummaryMessage, type AgentMessage } from "@earendil-works/pi-agent-core";
import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { AgentContinuityLedgerSchema, type AgentContinuityLedger } from "../Continuity/AgentContinuityLedger.js";
import { AgentPiArtifactIndexSchema, type AgentPiArtifactIndex } from "./AgentPiArtifactIndex.js";
import type { AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import {
  AgentPiCompactionToolCallIndexSchema,
  type AgentPiCompactionToolCallIndex,
} from "./AgentPiCompactionToolIndex.js";

/**
 * A candidate is a derived, model-facing checkpoint. Pi's append-only session
 * remains authoritative until the candidate is formally committed as a native
 * compaction entry.
 */
export const AgentPiCompactionCandidateProtocol = defineSeneraProtocol("compaction_candidate", 1);

const NonBlankStringSchema = z.string().trim().min(1);

const CandidateIndexesSchema = z
  .object({
    artifactIndex: AgentPiArtifactIndexSchema,
    toolCallIndex: AgentPiCompactionToolCallIndexSchema,
    continuityLedger: AgentContinuityLedgerSchema.optional(),
  })
  .strict();

const AgentPiCompactionCandidateSchema = z
  .object({
    type: z.literal(AgentPiCompactionCandidateProtocol.type),
    version: z.literal(AgentPiCompactionCandidateProtocol.version),
    id: NonBlankStringSchema,
    sessionId: NonBlankStringSchema,
    branchEpoch: NonBlankStringSchema.nullable(),
    snapshotLeafId: NonBlankStringSchema,
    snapshotDigest: NonBlankStringSchema,
    firstKeptEntryId: NonBlankStringSchema,
    tokensBefore: z.number().int().min(0),
    summary: NonBlankStringSchema,
    indexes: CandidateIndexesSchema,
    indexDigest: NonBlankStringSchema,
    modelRouteDigest: NonBlankStringSchema,
    promptRevision: NonBlankStringSchema,
    projectionRevision: NonBlankStringSchema,
    createdAt: NonBlankStringSchema,
  })
  .strict();

export interface AgentPiCompactionCandidate {
  readonly type: typeof AgentPiCompactionCandidateProtocol.type;
  readonly version: typeof AgentPiCompactionCandidateProtocol.version;
  readonly id: string;
  readonly sessionId: string;
  /** The most recent formal Pi compaction when this candidate was captured. */
  readonly branchEpoch: string | null;
  /** The final immutable entry represented by this checkpoint. */
  readonly snapshotLeafId: string;
  /** Digest of the branch prefix through snapshotLeafId. */
  readonly snapshotDigest: string;
  /** Pi entry retained verbatim after the checkpoint. */
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly summary: string;
  readonly indexes: AgentPiCompactionIndexes;
  readonly indexDigest: string;
  readonly modelRouteDigest: string;
  readonly promptRevision: string;
  readonly projectionRevision: string;
  readonly createdAt: string;
}

export interface AgentPiCompactionCandidateValidation {
  readonly valid: boolean;
  readonly reason?:
    | "branch_epoch_changed"
    | "snapshot_missing"
    | "snapshot_changed"
    | "boundary_missing"
    | "boundary_after_snapshot"
    | "route_changed"
    | "prompt_changed"
    | "projection_changed";
  readonly snapshotIndex?: number;
  readonly firstKeptIndex?: number;
}

export interface AgentPiCompactionCandidateProjection {
  readonly candidate: AgentPiCompactionCandidate;
  readonly messages: AgentMessage[];
}

export function createAgentPiCompactionCandidate(input: {
  readonly id: string;
  readonly sessionId: string;
  readonly branchEntries: readonly SessionEntry[];
  readonly snapshotLeafId: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly summary: string;
  readonly indexes: AgentPiCompactionIndexes;
  readonly modelRouteDigest: string;
  readonly promptRevision: string;
  readonly projectionRevision: string;
  readonly createdAt?: string;
}): AgentPiCompactionCandidate {
  const id = requireText(input.id, "Compaction candidate id");
  const sessionId = requireText(input.sessionId, "Compaction candidate session id");
  const snapshotLeafId = requireText(input.snapshotLeafId, "Compaction candidate snapshot leaf id");
  const firstKeptEntryId = requireText(input.firstKeptEntryId, "Compaction candidate boundary id");
  const summary = requireText(input.summary, "Compaction candidate summary");
  const snapshotIndex = input.branchEntries.findIndex((entry) => entry.id === snapshotLeafId);
  const firstKeptIndex = input.branchEntries.findIndex((entry) => entry.id === firstKeptEntryId);
  if (snapshotIndex < 0) throw new Error("Compaction candidate snapshot leaf is not in the active branch.");
  if (firstKeptIndex < 0 || firstKeptIndex > snapshotIndex) {
    throw new Error("Compaction candidate boundary must precede its snapshot leaf.");
  }

  const indexes = cloneIndexes(input.indexes);
  return {
    type: AgentPiCompactionCandidateProtocol.type,
    version: AgentPiCompactionCandidateProtocol.version,
    id,
    sessionId,
    branchEpoch: resolveAgentPiCompactionBranchEpoch(input.branchEntries),
    snapshotLeafId,
    snapshotDigest: agentPiCompactionCandidateSnapshotDigest(input.branchEntries, snapshotIndex),
    firstKeptEntryId,
    tokensBefore: normalizeTokensBefore(input.tokensBefore),
    summary,
    indexes,
    indexDigest: agentPiCompactionCandidateIndexesDigest(indexes),
    modelRouteDigest: requireText(input.modelRouteDigest, "Compaction candidate model route digest"),
    promptRevision: requireText(input.promptRevision, "Compaction candidate prompt revision"),
    projectionRevision: requireText(input.projectionRevision, "Compaction candidate projection revision"),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function readAgentPiCompactionCandidate(value: unknown): AgentPiCompactionCandidate | undefined {
  const parsed = AgentPiCompactionCandidateSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const indexes = cloneIndexes(parsed.data.indexes);
  if (agentPiCompactionCandidateIndexesDigest(indexes) !== parsed.data.indexDigest) return undefined;
  return {
    type: parsed.data.type,
    version: parsed.data.version,
    id: parsed.data.id,
    sessionId: parsed.data.sessionId,
    branchEpoch: parsed.data.branchEpoch,
    snapshotLeafId: parsed.data.snapshotLeafId,
    snapshotDigest: parsed.data.snapshotDigest,
    firstKeptEntryId: parsed.data.firstKeptEntryId,
    tokensBefore: parsed.data.tokensBefore,
    summary: parsed.data.summary,
    indexes,
    indexDigest: parsed.data.indexDigest,
    modelRouteDigest: parsed.data.modelRouteDigest,
    promptRevision: parsed.data.promptRevision,
    projectionRevision: parsed.data.projectionRevision,
    createdAt: parsed.data.createdAt,
  };
}

export function validateAgentPiCompactionCandidate(
  candidate: AgentPiCompactionCandidate,
  input: {
    readonly sessionId: string;
    readonly branchEntries: readonly SessionEntry[];
    readonly modelRouteDigest: string;
    readonly promptRevision: string;
    readonly projectionRevision: string;
  },
): AgentPiCompactionCandidateValidation {
  if (candidate.sessionId !== input.sessionId) return { valid: false, reason: "snapshot_missing" };
  if (candidate.branchEpoch !== resolveAgentPiCompactionBranchEpoch(input.branchEntries)) {
    return { valid: false, reason: "branch_epoch_changed" };
  }
  if (candidate.modelRouteDigest !== input.modelRouteDigest) return { valid: false, reason: "route_changed" };
  if (candidate.promptRevision !== input.promptRevision) return { valid: false, reason: "prompt_changed" };
  if (candidate.projectionRevision !== input.projectionRevision) {
    return { valid: false, reason: "projection_changed" };
  }

  const snapshotIndex = input.branchEntries.findIndex((entry) => entry.id === candidate.snapshotLeafId);
  if (snapshotIndex < 0) return { valid: false, reason: "snapshot_missing" };
  if (agentPiCompactionCandidateSnapshotDigest(input.branchEntries, snapshotIndex) !== candidate.snapshotDigest) {
    return { valid: false, reason: "snapshot_changed" };
  }
  const firstKeptIndex = input.branchEntries.findIndex((entry) => entry.id === candidate.firstKeptEntryId);
  if (firstKeptIndex < 0) return { valid: false, reason: "boundary_missing" };
  if (firstKeptIndex > snapshotIndex) return { valid: false, reason: "boundary_after_snapshot" };
  return { valid: true, snapshotIndex, firstKeptIndex };
}

export function projectAgentPiCompactionCandidate(
  candidate: AgentPiCompactionCandidate,
  branchEntries: readonly SessionEntry[],
  validation: AgentPiCompactionCandidateValidation,
): AgentPiCompactionCandidateProjection | undefined {
  if (!validation.valid || validation.firstKeptIndex === undefined) return undefined;
  const retainedMessages = branchEntries
    .slice(validation.firstKeptIndex)
    .flatMap((entry) => (entry.type === "compaction" ? [] : sessionEntryToContextMessages(entry)));
  return {
    candidate,
    messages: [
      createCompactionSummaryMessage(candidate.summary, candidate.tokensBefore, candidate.createdAt),
      ...retainedMessages,
    ],
  };
}

export function resolveAgentPiCompactionBranchEpoch(entries: readonly SessionEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "compaction") return entry.id;
  }
  return null;
}

export function agentPiCompactionCandidateSnapshotDigest(
  entries: readonly SessionEntry[],
  snapshotIndex: number,
): string {
  if (!Number.isInteger(snapshotIndex) || snapshotIndex < 0 || snapshotIndex >= entries.length) {
    throw new RangeError("Compaction candidate snapshot index is outside the branch.");
  }
  return sha256HexOfCanonicalJson(
    entries.slice(0, snapshotIndex + 1).map((entry) => ({
      id: entry.id,
      parentId: entry.parentId,
      type: entry.type,
    })),
  );
}

export function agentPiCompactionCandidateIndexesDigest(indexes: AgentPiCompactionIndexes): string {
  return sha256HexOfCanonicalJson(indexes);
}

function cloneIndexes(value: {
  readonly artifactIndex: AgentPiArtifactIndex;
  readonly toolCallIndex: AgentPiCompactionToolCallIndex;
  readonly continuityLedger?: AgentContinuityLedger;
}): AgentPiCompactionIndexes {
  const artifactIndex = AgentPiArtifactIndexSchema.parse(value.artifactIndex);
  const toolCallIndex = AgentPiCompactionToolCallIndexSchema.parse(value.toolCallIndex);
  const continuityLedger = value.continuityLedger
    ? AgentContinuityLedgerSchema.parse(value.continuityLedger)
    : undefined;
  return {
    artifactIndex,
    toolCallIndex,
    ...(continuityLedger ? { continuityLedger } : {}),
  };
}

function normalizeTokensBefore(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError("Compaction candidate tokensBefore must be non-negative.");
  return Math.floor(value);
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must be non-blank.`);
  return normalized;
}
