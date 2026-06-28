import { z } from "zod";

export const TextSchema = z.preprocess(coerceStringLike, z.string());
export const NonEmptyTextSchema = z.preprocess(coerceStringLike, z.string().trim().min(1));
export const PositiveIntSchema = z.preprocess(coerceNumberLike, z.number().int().positive());
export const BooleanLikeSchema = z.preprocess(coerceBooleanLike, z.boolean());

export const EditOperationSchema = z
  .object({
    action: z.enum([
      "create_file",
      "replace_file",
      "delete_file",
      "insert_before",
      "insert_after",
      "replace_range",
      "delete_range",
    ]),
    path: NonEmptyTextSchema,
    startLine: PositiveIntSchema.optional(),
    endLine: PositiveIntSchema.optional(),
    content: TextSchema.optional(),
  })
  .strict();

export const ApplyPatchArgumentsSchema = z
  .object({
    operations: z.object({
      item: z.array(EditOperationSchema).min(1).max(32),
    }),
    cwd: NonEmptyTextSchema.optional(),
    dryRun: BooleanLikeSchema.default(false),
    justification: NonEmptyTextSchema.optional(),
  })
  .strict();

export type ApplyPatchArguments = z.infer<typeof ApplyPatchArgumentsSchema>;
export type EditOperation = z.infer<typeof EditOperationSchema>;
export type EditAction = EditOperation["action"];

export interface FileChangeSummary {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface WritePlan {
  absolutePath: string;
  relativePath: string;
  status: FileChangeSummary["status"];
  additions: number;
  deletions: number;
  nextContent?: string;
}

export interface TargetFile {
  absolutePath: string;
  relativePath: string;
}

export interface LineEditContext {
  currentLines: string[];
  lineCount: number;
}

export class PatchApplyError extends Error {
  constructor(
    message: string,
    readonly diagnostics: string[] = [message],
    readonly pointer = "/operations",
  ) {
    super(message);
  }
}

function coerceStringLike(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}

function coerceNumberLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : value;
}

function coerceBooleanLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}
