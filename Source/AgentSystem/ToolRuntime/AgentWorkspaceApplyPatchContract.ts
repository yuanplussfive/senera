import { z } from "zod";

const MaxOperations = 64;

const WorkspacePathSchema = z.string().trim().min(1);
const NonEmptyTextSchema = z.string().min(1);

export const WorkspacePatchOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      path: WorkspacePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update"),
      path: WorkspacePathSchema,
      oldStr: NonEmptyTextSchema,
      newStr: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("write"),
      path: WorkspacePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete"),
      path: WorkspacePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      source: WorkspacePathSchema,
      destination: WorkspacePathSchema,
    })
    .strict(),
]);

export const WorkspaceApplyPatchArgumentsSchema = z
  .object({
    operations: z.array(WorkspacePatchOperationSchema).min(1).max(MaxOperations),
  })
  .strict();

const WorkspacePatchOperationResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      path: WorkspacePathSchema,
      changedPaths: z.array(WorkspacePathSchema).length(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update"),
      path: WorkspacePathSchema,
      matches: z.number().int().positive().optional(),
      changedPaths: z.array(WorkspacePathSchema).length(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("write"),
      path: WorkspacePathSchema,
      changedPaths: z.array(WorkspacePathSchema).length(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete"),
      path: WorkspacePathSchema,
      changedPaths: z.array(WorkspacePathSchema).length(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      source: WorkspacePathSchema,
      destination: WorkspacePathSchema,
      changedPaths: z.array(WorkspacePathSchema).length(2),
    })
    .strict(),
]);

const WorkspacePatchExtensionValidationSchema = z
  .object({
    kind: z.enum(["Skill", "MCP"]),
    name: z.string().trim().min(1),
    path: WorkspacePathSchema,
    status: z.literal("validated"),
  })
  .strict();

/**
 * Runtime-owned success contract for the atomic workspace patch capability.
 * The extension manifest is generated from this schema, so consumers observe
 * exactly the shape the handler commits to producing.
 */
export const WorkspaceApplyPatchOutputSchema = z
  .object({
    text: z.string().min(1),
    applied: z.literal(true),
    operationCount: z.number().int().min(1).max(MaxOperations),
    changedPaths: z.array(WorkspacePathSchema),
    operations: z.array(WorkspacePatchOperationResultSchema).min(1).max(MaxOperations),
    extensions: z.array(WorkspacePatchExtensionValidationSchema),
  })
  .strict();

export type WorkspaceApplyPatchArguments = z.infer<typeof WorkspaceApplyPatchArgumentsSchema>;
export type WorkspacePatchOperation = z.infer<typeof WorkspacePatchOperationSchema>;
