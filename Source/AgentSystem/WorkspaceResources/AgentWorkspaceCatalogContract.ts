import { z } from "zod/mini";

export const AgentWorkspaceCatalogRoute = "/api/workspaces";

export const AgentWorkspaceDescriptorSchema = z.strictObject({
  id: z.uuid(),
  root: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
});

export const AgentWorkspaceCatalogSchema = z.strictObject({
  workspaces: z.array(AgentWorkspaceDescriptorSchema),
});

export const AgentWorkspaceCatalogSnapshotSchema = z.strictObject({
  workspaces: z.array(AgentWorkspaceDescriptorSchema),
  defaultWorkspaceId: z.uuid(),
});

export type AgentWorkspaceDescriptor = z.infer<typeof AgentWorkspaceDescriptorSchema>;
export type AgentWorkspaceCatalogSnapshot = z.infer<typeof AgentWorkspaceCatalogSnapshotSchema>;
