import { z } from "zod";

export const AgentApplicationHttpRoutes = { Storage: "/api/application-storage" } as const;

export const AgentApplicationStorageSnapshotSchema = z.object({
  root: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      root: z.string().min(1),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});

export type AgentApplicationStorageSnapshot = z.infer<typeof AgentApplicationStorageSnapshotSchema>;
