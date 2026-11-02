import { z } from "zod";
import { AgentResourceReferenceOrigins } from "../Resources/AgentResourceReference.js";

const EntryKindSchema = z.enum(["file", "directory", "missing", "other", "symlink"]);

/** Metadata only: file contents, patches, and absolute paths stay in Artifacts. */
const WorkspaceTransitionSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "unchanged", "type_changed"]),
  beforeKind: EntryKindSchema,
  afterKind: EntryKindSchema,
  beforeHash: z.string(),
  afterHash: z.string(),
  beforeSize: z.number().nonnegative(),
  afterSize: z.number().nonnegative(),
  addedLines: z.number().int().nonnegative().optional(),
  removedLines: z.number().int().nonnegative().optional(),
});

export const AgentPiWorkspaceToolContextSchema = z.object({
  version: z.literal(1),
  capture: z
    .object({
      id: z.string(),
      source: z.enum(["mutation-receipt", "filesystem-observer"]).optional(),
      sources: z.array(z.enum(["mutation-receipt", "filesystem-observer"])).optional(),
      coverage: z.enum(["exact", "observed"]).optional(),
      quality: z.enum(["complete", "bounded", "degraded"]).optional(),
      warningCount: z.number().int().nonnegative().optional(),
      scope: z.object({ kind: z.enum(["tool_batch", "resource"]), id: z.string() }).optional(),
      changes: z.array(WorkspaceTransitionSchema),
    })
    .optional(),
  outputs: z.array(
    z.object({
      uri: z.string(),
      name: z.string(),
      mime: z.string(),
      size: z.number().nonnegative().optional(),
      sha256: z.string().optional(),
      origin: z.enum(AgentResourceReferenceOrigins),
    }),
  ),
});

export type AgentPiWorkspaceToolContext = z.infer<typeof AgentPiWorkspaceToolContextSchema>;
export type AgentPiWorkspaceTransition = z.infer<typeof WorkspaceTransitionSchema>;

export interface AgentPiWorkspaceTurnContext {
  readonly scope: "previous-turn";
  readonly captures: readonly (Omit<NonNullable<AgentPiWorkspaceToolContext["capture"]>, "changes"> & {
    readonly details: readonly string[];
  })[];
  readonly changes: readonly (AgentPiWorkspaceTransition & {
    readonly captures: readonly string[];
    readonly continuity: "verified" | "unverified";
  })[];
  readonly outputs: AgentPiWorkspaceToolContext["outputs"];
  /** Historical results without the producer contract cannot establish zero changes. */
  readonly unavailableResults: number;
}
