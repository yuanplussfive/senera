import { z } from "zod";

const MaxOperations = 64;
const MaxFuzzFactor = 3;

const WorkspacePathSchema = z.string().trim().min(1);
const HunkPatchSchema = z.string().trim().min(1);
const Sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/)
  .transform((value) => value.toLowerCase());

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
      patch: HunkPatchSchema,
      expectedSha256: Sha256Schema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("replace"),
      path: WorkspacePathSchema,
      content: z.string(),
      expectedSha256: Sha256Schema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete"),
      path: WorkspacePathSchema,
      expectedSha256: Sha256Schema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      source: WorkspacePathSchema,
      destination: WorkspacePathSchema,
      patch: HunkPatchSchema.optional(),
      expectedSha256: Sha256Schema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("createDirectory"),
      path: WorkspacePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("deleteDirectory"),
      path: WorkspacePathSchema,
      recursive: z.boolean().optional(),
    })
    .strict(),
]);

export const WorkspaceApplyPatchArgumentsSchema = z
  .object({
    operations: z.array(WorkspacePatchOperationSchema).min(1).max(MaxOperations),
    dryRun: z.boolean().optional(),
    fuzzFactor: z.number().int().min(0).max(MaxFuzzFactor).optional(),
  })
  .strict();

export type WorkspaceApplyPatchArguments = z.infer<typeof WorkspaceApplyPatchArgumentsSchema>;
export type WorkspacePatchOperation = z.infer<typeof WorkspacePatchOperationSchema>;
