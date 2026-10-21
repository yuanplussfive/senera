import { z } from "zod";

export const AgentApplicationHttpRoutes = {
  Storage: "/api/application-storage",
  StorageMigrations: "/api/application-storage/migrations",
} as const;
export const AgentApplicationStorageScopes = {
  Runtime: "runtime",
  Project: "project",
} as const;
export type AgentApplicationStorageScope =
  (typeof AgentApplicationStorageScopes)[keyof typeof AgentApplicationStorageScopes];

export const AgentApplicationStorageCoverageStates = {
  Complete: "complete",
  Partial: "partial",
} as const;

export const AgentApplicationStorageUsageSchema = z.object({
  bytes: z.number().int().nonnegative(),
  coverage: z.enum([AgentApplicationStorageCoverageStates.Complete, AgentApplicationStorageCoverageStates.Partial]),
  unavailableEntryCount: z.number().int().nonnegative(),
});

export const AgentApplicationStorageSnapshotSchema = z.object({
  root: z.string().min(1),
  scope: z.literal("application-state"),
  ...AgentApplicationStorageUsageSchema.shape,
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      root: z.string().min(1),
      stateRoot: z.string().min(1),
      scope: z.literal("workspace-state"),
      ...AgentApplicationStorageUsageSchema.shape,
      projectBytes: z.number().int().nonnegative().optional(),
      projectCoverage: z
        .enum([AgentApplicationStorageCoverageStates.Complete, AgentApplicationStorageCoverageStates.Partial])
        .optional(),
      projectUnavailableEntryCount: z.number().int().nonnegative().optional(),
    }),
  ),
  projectScanIncluded: z.boolean(),
  projectScanWorkspaceId: z.string().uuid().optional(),
});

export type AgentApplicationStorageSnapshot = z.infer<typeof AgentApplicationStorageSnapshotSchema>;

export const AgentWorkspaceStateMigrationInventorySchema = z.object({
  stateRoot: z.string().min(1),
  migrationRoot: z.string().min(1),
  markerPath: z.string().min(1),
  markerStatus: z.enum(["missing", "valid", "invalid"]),
  backups: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      createdAt: z.string().datetime(),
      referencedByMarker: z.boolean(),
    }),
  ),
});

export const AgentApplicationStorageMigrationSnapshotSchema = z.object({
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      root: z.string().min(1),
      inventory: AgentWorkspaceStateMigrationInventorySchema,
    }),
  ),
});

export type AgentApplicationStorageMigrationSnapshot = z.infer<typeof AgentApplicationStorageMigrationSnapshotSchema>;
