export const AgentResidentProfileSubjects = ["agent", "user"] as const;
export type AgentResidentProfileSubject = (typeof AgentResidentProfileSubjects)[number];

export const AgentResidentProfileMaturities = ["candidate", "active", "established"] as const;
export type AgentResidentProfileMaturity = (typeof AgentResidentProfileMaturities)[number];

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
