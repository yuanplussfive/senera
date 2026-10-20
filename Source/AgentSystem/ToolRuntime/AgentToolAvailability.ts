import { z } from "zod";

/** Discovery describes capabilities even when their execution prerequisites are absent. */
export type AgentToolAvailability =
  | { readonly status: "ready" }
  | { readonly status: "unverified" }
  | { readonly status: "needs_input"; readonly inputIds: readonly string[] }
  | { readonly status: "unavailable"; readonly reason: string; readonly message?: string };

export const AgentToolAvailabilitySchema: z.ZodType<AgentToolAvailability> = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready") }).strict(),
  z.object({ status: z.literal("unverified") }).strict(),
  z.object({ status: z.literal("needs_input"), inputIds: z.array(z.string()) }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.string(), message: z.string().optional() }).strict(),
]);

export const ReadyAgentToolAvailability = { status: "ready" } as const;

export function isAgentToolExecutable(tool: { readonly availability?: AgentToolAvailability }): boolean {
  return tool.availability === undefined || tool.availability.status === "ready";
}
