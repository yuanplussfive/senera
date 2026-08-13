import path from "node:path";
import type { AgentWorkspaceResourceDomain } from "../Core/AgentWorkspaceLayout.js";
import { isPathWithin, isSamePath } from "../Core/AgentPath.js";

export const AgentResourceAccessIntents = {
  Inspect: "inspect",
  Read: "read",
  Create: "create",
  Replace: "replace",
  Remove: "remove",
  Execute: "execute",
} as const;

export type AgentResourceAccessIntent = (typeof AgentResourceAccessIntents)[keyof typeof AgentResourceAccessIntents];

export const AgentResourceAccessAuthorities = {
  Tool: "tool",
  ManagedExtensionPublisher: "managed-extension-publisher",
} as const;

export type AgentResourceAccessAuthority =
  (typeof AgentResourceAccessAuthorities)[keyof typeof AgentResourceAccessAuthorities];

export const AgentResourceAccessGrantModes = {
  ApprovedHost: "approved-host",
  FullHost: "full-host",
} as const;

export type AgentResourceAccessGrantMode =
  (typeof AgentResourceAccessGrantModes)[keyof typeof AgentResourceAccessGrantModes];

export interface AgentResourceAccessFacts {
  readonly scope: "workspace" | "temporary";
  readonly intent: AgentResourceAccessIntent;
  readonly authority: AgentResourceAccessAuthority;
  readonly domain: AgentWorkspaceResourceDomain;
  readonly domainRoot: boolean;
  readonly relativePath: string;
  readonly containment: "inside" | "outside" | "unknown";
  readonly linkTraversal: "none" | "internal" | "external" | "broken";
  readonly finalEntry: "missing" | "file" | "directory" | "link" | "other" | "unknown";
}

export interface AgentResourceAccessRequest {
  readonly addressedPath: string;
  readonly canonicalPath?: string;
  readonly intent: AgentResourceAccessIntent;
  readonly recursive: boolean;
  readonly facts: AgentResourceAccessFacts;
}

export interface AgentResourceAccessPlan {
  readonly requests: readonly AgentResourceAccessRequest[];
  readonly external: readonly AgentResourceAccessRequest[];
}

export interface AgentResourceAccessGrantEntry {
  readonly canonicalPath: string;
  readonly intent: AgentResourceAccessIntent;
  readonly recursive: boolean;
}

export interface AgentResourceAccessBinding {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface AgentResourceAccessGrant {
  readonly mode: AgentResourceAccessGrantMode;
  readonly resources: readonly AgentResourceAccessGrantEntry[];
  readonly binding: AgentResourceAccessBinding;
}

export function createAgentResourceAccessGrant(input: {
  mode: AgentResourceAccessGrantMode;
  resources?: readonly AgentResourceAccessGrantEntry[];
  binding?: AgentResourceAccessGrant["binding"];
}): AgentResourceAccessGrant {
  const resources = (input.resources ?? []).map((resource) =>
    Object.freeze({
      canonicalPath: path.resolve(resource.canonicalPath),
      intent: resource.intent,
      recursive: resource.recursive,
    }),
  );
  return Object.freeze({
    mode: input.mode,
    resources: Object.freeze(resources),
    binding: Object.freeze({ ...(input.binding ?? {}) }),
  });
}

export function resourceAccessGrantAllows(
  grant: AgentResourceAccessGrant,
  canonicalPath: string,
  intent: AgentResourceAccessIntent,
): boolean {
  if (grant.mode === AgentResourceAccessGrantModes.FullHost) return true;
  const target = path.resolve(canonicalPath);
  return grant.resources.some(
    (resource) =>
      intentIsCovered(resource.intent, intent) &&
      (resource.recursive ? isPathWithin(resource.canonicalPath, target) : isSamePath(resource.canonicalPath, target)),
  );
}

export function resourceAccessGrantMatchesBinding(
  grant: AgentResourceAccessGrant,
  binding: AgentResourceAccessBinding,
): boolean {
  return (Object.keys(grant.binding) as Array<keyof AgentResourceAccessBinding>).every(
    (key) => grant.binding[key] === undefined || grant.binding[key] === binding[key],
  );
}

function intentIsCovered(granted: AgentResourceAccessIntent, requested: AgentResourceAccessIntent): boolean {
  if (granted === requested) return true;
  if (granted === AgentResourceAccessIntents.Read) {
    return requested === AgentResourceAccessIntents.Inspect;
  }
  if (
    granted === AgentResourceAccessIntents.Create ||
    granted === AgentResourceAccessIntents.Replace ||
    granted === AgentResourceAccessIntents.Remove
  ) {
    return (
      requested === AgentResourceAccessIntents.Inspect ||
      requested === AgentResourceAccessIntents.Read ||
      requested === AgentResourceAccessIntents.Create ||
      requested === AgentResourceAccessIntents.Replace ||
      requested === AgentResourceAccessIntents.Remove
    );
  }
  return false;
}

export interface SeneraResourceAccessAuthorizer {
  authorize(resource: AgentResourceAccessFacts): Promise<unknown>;
}
