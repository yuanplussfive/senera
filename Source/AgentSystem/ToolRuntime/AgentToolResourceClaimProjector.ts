import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import type { AgentToolResourceCapabilityRegistry } from "./AgentToolResourceCapabilityRegistry.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  AgentToolResourceAccessModes,
  createExactAgentToolResourceClaimDomain,
  type AgentToolResourceClaim,
  type AgentToolResourceLeaseRequest,
} from "./AgentToolResourceClaimTypes.js";

const McpServerResourceDomain = createExactAgentToolResourceClaimDomain("senera.mcp.server");

export interface AgentToolResourceClaimProjectorPort {
  project(tool: RegisteredTool, args: Readonly<Record<string, unknown>>): Promise<AgentToolResourceLeaseRequest>;
}

export class AgentToolResourceClaimProjector implements AgentToolResourceClaimProjectorPort {
  constructor(private readonly capabilities: AgentToolResourceCapabilityRegistry) {}

  async project(tool: RegisteredTool, args: Readonly<Record<string, unknown>>): Promise<AgentToolResourceLeaseRequest> {
    const resources = tool.handler.resources ?? [];
    if (resources.length === 0) return fallbackResourceRequest(tool);

    try {
      const claims = await Promise.all(
        resources.map(async (resource) => {
          const value = readAgentJsonPointer(args, resource.Pointer);
          return value.found ? this.capabilities.claim(resource, value.value, args) : undefined;
        }),
      );
      const normalized = normalizeClaims(claims.flatMap((claim) => claim ?? []));
      return normalized.length > 0 ? { mode: "claims", claims: normalized } : { mode: "exclusive" };
    } catch {
      // Execution remains authoritative for argument diagnostics; scheduling fails closed.
      return { mode: "exclusive" };
    }
  }
}

function fallbackResourceRequest(tool: RegisteredTool): AgentToolResourceLeaseRequest {
  if (tool.handler.kind !== "McpTool") return { mode: "exclusive" };
  return {
    mode: "claims",
    claims: [
      {
        domain: McpServerResourceDomain,
        identity: tool.handler.server.id,
        access: tool.handler.readOnly ? AgentToolResourceAccessModes.Shared : AgentToolResourceAccessModes.Exclusive,
      },
    ],
  };
}

function normalizeClaims(claims: readonly AgentToolResourceClaim[]): AgentToolResourceClaim[] {
  const claimsByIdentity = new Map<string, AgentToolResourceClaim>();
  for (const claim of claims) {
    const key = stringifyAgentCanonicalJson([claim.domain.id, claim.identity]);
    const current = claimsByIdentity.get(key);
    claimsByIdentity.set(key, {
      domain: claim.domain,
      identity: claim.identity,
      access:
        current?.access === AgentToolResourceAccessModes.Exclusive ||
        claim.access === AgentToolResourceAccessModes.Exclusive
          ? AgentToolResourceAccessModes.Exclusive
          : AgentToolResourceAccessModes.Shared,
    });
  }
  return [...claimsByIdentity.values()];
}
