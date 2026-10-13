import { z } from "zod/mini";

export const AgentWorkspaceCatalogRoute = "/api/workspaces";
export const AgentWorkspaceIdSchema = z.uuid();
export type AgentWorkspaceId = z.infer<typeof AgentWorkspaceIdSchema>;

export const AgentWorkspaceDescriptorSchema = z.strictObject({
  id: AgentWorkspaceIdSchema,
  root: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
});

export const AgentWorkspaceCatalogSchema = z.strictObject({
  workspaces: z.array(AgentWorkspaceDescriptorSchema),
});

export const AgentWorkspaceCatalogSnapshotSchema = z.strictObject({
  workspaces: z.array(AgentWorkspaceDescriptorSchema),
  defaultWorkspaceId: AgentWorkspaceIdSchema,
});

export type AgentWorkspaceDescriptor = z.infer<typeof AgentWorkspaceDescriptorSchema>;
export type AgentWorkspaceCatalogSnapshot = z.infer<typeof AgentWorkspaceCatalogSnapshotSchema>;
