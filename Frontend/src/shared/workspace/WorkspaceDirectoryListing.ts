import { z } from "zod/mini";

/**
 * Contract for `GET /api/workspace-directories`, shared by the provider that
 * fetches it (`WorkspaceMenu`) and the lazy dialog that renders it
 * (`WorkspaceMenuDialogs`). Keeping the schema in a neutral module lets the
 * dialogs import the listing type without a module cycle back through the
 * provider that lazy-loads them.
 */
export const DirectoryListingSchema = z.object({
  path: z.string(),
  parent: z.nullable(z.string()),
  directories: z.array(z.object({ path: z.string(), name: z.string() })),
});
export type DirectoryListing = z.infer<typeof DirectoryListingSchema>;
export const DirectoryFailureSchema = z.object({ error: z.object({ message: z.string() }) });
