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

export type WorkspaceApplyPatchArguments = z.infer<typeof WorkspaceApplyPatchArgumentsSchema>;
export type WorkspacePatchOperation = z.infer<typeof WorkspacePatchOperationSchema>;
