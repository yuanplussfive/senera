import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { z } from "zod";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

export const AgentMcpServiceGrantSchema = z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict();
export type AgentMcpServiceGrant = z.infer<typeof AgentMcpServiceGrantSchema>;

const AgentToolAccessGrantSchema = z
  .object({
    authorizedToolNames: z.array(z.string().trim().min(1)),
    exposedToolNames: z.array(z.string().trim().min(1)),
    preferredToolNames: z.array(z.string().trim().min(1)),
    authorizedMcpServices: z.array(AgentMcpServiceGrantSchema).optional(),
  })
  .strict();

export interface AgentToolAccessGrant {
  readonly authorizedMcpServices?: readonly AgentMcpServiceGrant[];
  readonly authorizedToolNames: readonly string[];
  readonly exposedToolNames: readonly string[];
  readonly preferredToolNames: readonly string[];
}

export interface AgentToolAccessGrantInput {
  authorizedMcpServices?: readonly AgentMcpServiceGrant[];
  authorizedToolNames: readonly string[];
  exposedToolNames: readonly string[];
  preferredToolNames?: readonly string[];
}

export function createAgentToolAccessGrant(input: AgentToolAccessGrantInput): AgentToolAccessGrant {
  const authorizedToolNames = normalizeAgentToolNames(input.authorizedToolNames);
  const exposedToolNames = normalizeAgentToolNames(input.exposedToolNames);
  const preferredToolNames = normalizeAgentToolNames(input.preferredToolNames ?? []);

  assertToolNameSubset(exposedToolNames, authorizedToolNames, "exposed", "authorized");
  assertToolNameSubset(preferredToolNames, exposedToolNames, "preferred", "exposed");

  return deepFreeze({
    authorizedToolNames,
    exposedToolNames,
    preferredToolNames,
    ...(input.authorizedMcpServices?.length
      ? {
          authorizedMcpServices: input.authorizedMcpServices.map((service) =>
            AgentMcpServiceGrantSchema.parse(service),
          ),
        }
      : {}),
  });
}

export function emptyAgentToolAccessGrant(): AgentToolAccessGrant {
  return createAgentToolAccessGrant({
    authorizedToolNames: [],
    exposedToolNames: [],
  });
}

export function cloneAgentToolAccessGrant(grant: AgentToolAccessGrant): AgentToolAccessGrant {
  return createAgentToolAccessGrant(grant);
}

export function parseAgentToolAccessGrant(value: unknown): AgentToolAccessGrant | undefined {
  const parsed = AgentToolAccessGrantSchema.safeParse(value);
  return parsed.success ? createAgentToolAccessGrant(parsed.data) : undefined;
}

export function orderToolNamesByPreference(
  toolNames: readonly string[],
  preferredToolNames: readonly string[],
): string[] {
  const available = new Set(toolNames);
  const preferred = normalizeAgentToolNames(preferredToolNames).filter((toolName) => available.has(toolName));
  const preferredSet = new Set(preferred);
  return [...preferred, ...normalizeAgentToolNames(toolNames).filter((toolName) => !preferredSet.has(toolName))];
}

export function isAgentToolAuthorized(
  grant: AgentToolAccessGrant,
  tool: string | Pick<RegisteredTool, "name" | "handler">,
): boolean {
  if (grant.authorizedToolNames.includes(typeof tool === "string" ? tool : tool.name)) return true;
  return (
    typeof tool !== "string" &&
    tool.handler.kind === "McpTool" &&
    isAgentMcpServiceAuthorized(grant, tool.handler.server)
  );
}

export function isAgentMcpServiceAuthorized(grant: AgentToolAccessGrant, service: AgentMcpServiceGrant): boolean {
  return (
    grant.authorizedMcpServices?.some(
      (allowed) => allowed.id === service.id && allowed.revision === service.revision,
    ) === true
  );
}

export function resolveAgentToolGrantNames(grant: AgentToolAccessGrant, tools: readonly RegisteredTool[]): string[] {
  return tools.filter((tool) => isAgentToolAuthorized(grant, tool)).map((tool) => tool.name);
}

export function isAgentToolInitiallyExposed(grant: AgentToolAccessGrant, toolName: string): boolean {
  return grant.exposedToolNames.includes(toolName);
}

export function normalizeAgentToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.map((toolName) => toolName.trim()).filter(Boolean))];
}

export function hasSameAgentToolNameSequence(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((toolName, index) => toolName === right[index]);
}

function assertToolNameSubset(
  subset: readonly string[],
  superset: readonly string[],
  subsetName: string,
  supersetName: string,
): void {
  const available = new Set(superset);
  const invalid = subset.filter((toolName) => !available.has(toolName));
  if (invalid.length === 0) return;
  throw new AgentLocalizedError("toolAccess.invalidSubset", {
    subset: subsetName,
    superset: supersetName,
    toolNames: invalid.join(", "),
  });
}
