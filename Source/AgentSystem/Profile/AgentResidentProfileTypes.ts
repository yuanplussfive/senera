import { z } from "zod";
import { AgentContinuityAuthorities, AgentContinuityScopes } from "../Continuity/AgentContinuityDomain.js";
import type {
  AgentContinuityAuthority,
  AgentContinuityScopeRef,
  AgentContinuityScalar,
} from "../Continuity/AgentContinuityDomain.js";
import {
  AgentContinuityRuleConsolidationDefaults,
  resolveAgentContinuityRuleMaturity,
  type AgentContinuityRuleConsolidationPolicy,
} from "../Continuity/AgentContinuityRuleConsolidationPolicy.js";

export const AgentResidentProfileSubjects = ["agent", "user"] as const;
export type AgentResidentProfileSubject = (typeof AgentResidentProfileSubjects)[number];

export const AgentResidentProfileStatuses = ["active", "superseded", "retracted"] as const;
export type AgentResidentProfileStatus = (typeof AgentResidentProfileStatuses)[number];

export const AgentResidentProfileMaturities = ["candidate", "active", "established"] as const;
export type AgentResidentProfileMaturity = (typeof AgentResidentProfileMaturities)[number];

export const AgentResidentProfileHistoryOperations = ["created", "reinforced", "superseded", "retracted"] as const;
export type AgentResidentProfileHistoryOperation = (typeof AgentResidentProfileHistoryOperations)[number];

export interface AgentResidentProfileTemporal {
  readonly until: "session" | "permanent" | string;
  readonly timeZone: string;
}

export interface AgentResidentProfileRecord {
  readonly id: string;
  readonly uri: string;
  readonly subject: AgentResidentProfileSubject;
  readonly key: string;
  readonly value: AgentContinuityScalar;
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly temporal: AgentResidentProfileTemporal;
  readonly sourceRefs: readonly string[];
  readonly status: AgentResidentProfileStatus;
  readonly maturity: AgentResidentProfileMaturity;
  /** The record that replaced this version; null while the version is active. */
  readonly supersededBy: string | null;
  /** Independent episode evidence rows backing this version. */
  readonly supportCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Profile evidence matures through the same thresholds and authority rules as
 * continuity rules, so both ledgers read identically downstream.
 */
export function resolveAgentResidentProfileMaturity(
  authority: AgentContinuityAuthority,
  supportCount: number,
  policy: AgentContinuityRuleConsolidationPolicy = AgentContinuityRuleConsolidationDefaults,
): AgentResidentProfileMaturity {
  return resolveAgentContinuityRuleMaturity(authority, supportCount, policy);
}

export interface AgentResidentProfileDraft {
  readonly subject: AgentResidentProfileSubject;
  readonly key: string;
  readonly value: AgentContinuityScalar;
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly temporal: AgentResidentProfileTemporal;
  readonly sourceRefs: readonly string[];
}

export interface AgentResidentProfilePromptEntry {
  readonly subject: AgentResidentProfileSubject;
  readonly key: string;
  readonly valueJson: string;
  readonly claim: string;
  /** Stable Liquid boundary: empty when the profile is session-scoped or permanent. */
  readonly validUntil: string;
  /** Host-only provenance used to avoid projecting the same claim twice. */
  readonly sourceRefs: readonly string[];
  /** Optional for stable snapshots written before maturity projection was added. */
  readonly maturity?: AgentResidentProfileMaturity;
  /** Optional for stable snapshots written before evidence counts were added. */
  readonly supportCount?: number;
}

export interface AgentResidentProfileHistoryEntry {
  readonly id: string;
  readonly profileId: string;
  readonly operation: AgentResidentProfileHistoryOperation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly occurredAt: string;
}

export const AgentResidentProfileValueSchema = z.union([
  z.string().trim().min(1).max(500),
  z.number().finite(),
  z.boolean(),
]);

export const AgentResidentProfileDraftSchema = z
  .object({
    subject: z.enum(AgentResidentProfileSubjects),
    key: z.string().trim().min(1).max(120),
    value: AgentResidentProfileValueSchema,
    scope: z.object({ kind: z.enum(AgentContinuityScopes), id: z.string().trim().min(1) }).strict(),
    authority: z.enum(AgentContinuityAuthorities),
    confidence: z.number().min(0).max(1),
    temporal: z.object({ until: z.string().trim().min(1), timeZone: z.string().trim().min(1) }).strict(),
    sourceRefs: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export function normalizeAgentResidentProfileKey(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) throw new Error("Resident profile key cannot be empty.");
  return normalized;
}

export function normalizeAgentResidentProfileUntil(value: string): string {
  const normalized = value.trim();
  if (normalized === "session" || normalized === "permanent") return normalized;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp))
    throw new Error("Resident profile lifetime must be session, permanent, or RFC 3339.");
  return new Date(timestamp).toISOString();
}

export function residentProfileClaim(key: string, value: AgentContinuityScalar): string {
  return `${normalizeAgentResidentProfileKey(key)}: ${String(value)}`;
}
