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
    if (resources.length === 0) return projectMcpServerResourceRequest(tool);

    const claims = await Promise.all(
      resources.map(async (resource) => {
        const value = readAgentJsonPointer(args, resource.Pointer);
        if (!value.found) {
          throw new TypeError(`Tool resource argument is missing: ${resource.Pointer}`);
        }
        const projected = await this.capabilities.claim(resource, value.value, args);
        if (!projected) {
          throw new TypeError(`Tool resource capability does not support scheduling claims: ${resource.Capability}`);
        }
        return projected;
      }),
    );
    const normalized = normalizeClaims(claims.flat());
    if (normalized.length === 0) {
      throw new TypeError(`Tool ${tool.name} did not project any scheduling claims.`);
    }
    return { mode: "claims", claims: normalized };
  }
}

function projectMcpServerResourceRequest(tool: RegisteredTool): AgentToolResourceLeaseRequest {
  if (tool.handler.kind !== "McpTool") {
    throw new TypeError(`Tool ${tool.name} uses ResourceClaims scheduling without declaring resources.`);
  }
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
