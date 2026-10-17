import { z } from "zod";
import { AgentResourceUriSchema } from "./AgentResourceSchema.js";

const AgentHttpResourceUrlSchema = z
  .string()
  .trim()
  .url()
  .regex(/^https?:\/\/\S+$/u, "Resource URLs must use HTTP or HTTPS.");

export const AgentResourceSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("senera_resource"),
      uri: AgentResourceUriSchema.describe("Canonical Senera resource identity."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("local_path"),
      path: z.string().trim().min(1).describe("Workspace-relative or absolute local path inside the active workspace."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("http_url"),
      url: AgentHttpResourceUrlSchema.describe(
        "Public HTTP(S) resource URL; private hosts remain subject to runtime policy.",
      ),
    })
    .strict(),
]);

export type AgentResourceSource = z.output<typeof AgentResourceSourceSchema>;
export type AgentLocalResourceSource = Extract<AgentResourceSource, { kind: "senera_resource" | "local_path" }>;
export type AgentHttpResourceSource = Extract<AgentResourceSource, { kind: "http_url" }>;
