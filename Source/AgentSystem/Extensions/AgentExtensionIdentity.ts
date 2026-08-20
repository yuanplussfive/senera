import { z } from "zod";

export const AgentExtensionNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Expected a lowercase kebab-case extension name.");

export type AgentExtensionName = z.infer<typeof AgentExtensionNameSchema>;

export function assertAgentExtensionName(value: string): AgentExtensionName {
  return AgentExtensionNameSchema.parse(value);
}
