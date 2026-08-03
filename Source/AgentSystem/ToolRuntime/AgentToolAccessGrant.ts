import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { z } from "zod";

const AgentToolAccessGrantSchema = z
  .object({
    authorizedToolNames: z.array(z.string().trim().min(1)),
    exposedToolNames: z.array(z.string().trim().min(1)),
    preferredToolNames: z.array(z.string().trim().min(1)),
  })
  .strict();

export interface AgentToolAccessGrant {
  readonly authorizedToolNames: readonly string[];
  readonly exposedToolNames: readonly string[];
  readonly preferredToolNames: readonly string[];
}

export interface AgentToolAccessGrantInput {
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

export function isAgentToolAuthorized(grant: AgentToolAccessGrant, toolName: string): boolean {
  return grant.authorizedToolNames.includes(toolName);
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
