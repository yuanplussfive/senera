import { z } from "zod";

export const CurrentAgentUpgradeSchemaVersion = 3 as const;

export const AgentUpgradeStatuses = {
  InProgress: "in_progress",
  Healthy: "healthy",
  Failed: "failed",
  RolledBack: "rolled_back",
} as const;

export const AgentUpgradeParticipantKinds = {
  File: "file",
  Sqlite: "sqlite",
} as const;

export const AgentUpgradeParticipantPhases = {
  BackedUp: "backed_up",
  DryRunPassed: "dry_run_passed",
  Migrated: "migrated",
  Restored: "restored",
} as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const VersionSchema = z.number().int().nonnegative();

const AgentUpgradeRuntimeIdentitySchema = z
  .object({
    appVersion: NonEmptyStringSchema.optional(),
    imageReference: NonEmptyStringSchema.optional(),
  })
  .strict();

const AgentUpgradeParticipantSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
    kind: z.enum([AgentUpgradeParticipantKinds.File, AgentUpgradeParticipantKinds.Sqlite]),
    dataClass: z.enum(["authoritative", "derived"]),
    sourcePath: NonEmptyStringSchema,
    backupPath: NonEmptyStringSchema,
    backupSha256: Sha256Schema,
    sourceVersion: VersionSchema.optional(),
    targetVersion: VersionSchema.optional(),
    phase: z.enum([
      AgentUpgradeParticipantPhases.BackedUp,
      AgentUpgradeParticipantPhases.DryRunPassed,
      AgentUpgradeParticipantPhases.Migrated,
      AgentUpgradeParticipantPhases.Restored,
    ]),
  })
  .strict();

const AgentUpgradeEventSchema = z
  .object({
    at: z.iso.datetime(),
    phase: NonEmptyStringSchema,
    participantId: NonEmptyStringSchema.optional(),
    detail: NonEmptyStringSchema.optional(),
  })
  .strict();

export const AgentUpgradeManifestSchema = z
  .object({
    schemaVersion: z.literal(CurrentAgentUpgradeSchemaVersion),
    upgradeId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    status: z.enum([
      AgentUpgradeStatuses.InProgress,
      AgentUpgradeStatuses.Healthy,
      AgentUpgradeStatuses.Failed,
      AgentUpgradeStatuses.RolledBack,
    ]),
    source: AgentUpgradeRuntimeIdentitySchema,
    target: AgentUpgradeRuntimeIdentitySchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    failure: NonEmptyStringSchema.optional(),
    participants: z.array(AgentUpgradeParticipantSchema),
    events: z.array(AgentUpgradeEventSchema),
  })
  .strict();

export const AgentRuntimeVersionMarkerSchema = z
  .object({
    schemaVersion: z.literal(CurrentAgentUpgradeSchemaVersion),
    appVersion: NonEmptyStringSchema,
    imageReference: NonEmptyStringSchema.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type AgentUpgradeManifest = z.infer<typeof AgentUpgradeManifestSchema>;
export type AgentUpgradeParticipant = z.infer<typeof AgentUpgradeParticipantSchema>;
export type AgentRuntimeVersionMarker = z.infer<typeof AgentRuntimeVersionMarkerSchema>;
