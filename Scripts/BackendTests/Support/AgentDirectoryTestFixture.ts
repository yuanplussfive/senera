import { AgentDirectory } from "../../../Source/AgentSystem/Profile/AgentDirectory.js";
import type { AgentDirectorySnapshot } from "../../../Source/AgentSystem/Core/AgentDirectoryContract.js";
import type {
  AgentEntityReferences,
  AgentIdentityDomain,
  AgentShortId,
} from "../../../Source/AgentSystem/Identity/AgentShortId.js";
import { allocateAgentShortId } from "../../../Source/AgentSystem/Identity/AgentShortIdAllocator.js";

export function createTestEntityReferences(): AgentEntityReferences {
  const domains = new Map<AgentIdentityDomain, Map<string, string>>();
  return {
    allocate<Domain extends AgentIdentityDomain>(domain: Domain, entityId: string): AgentShortId<Domain> {
      const entries = domains.get(domain) ?? new Map<string, string>();
      domains.set(domain, entries);
      const existing = [...entries].find(([, id]) => id === entityId)?.[0];
      return (
        (existing as AgentShortId<Domain> | undefined) ??
        allocateAgentShortId(
          domain,
          (reference) => {
            if (entries.has(reference)) return false;
            entries.set(reference, entityId);
            return true;
          },
          () => entries.size,
        )
      );
    },
    resolve: (domain, reference) => domains.get(domain)?.get(reference),
  };
}

export function createTestAgentDirectory(name = "Senera"): AgentDirectory {
  let stored: AgentDirectorySnapshot | undefined;
  return new AgentDirectory(
    {
      loadAgentDirectory: () => stored,
      saveAgentDirectory: (value) => {
        stored = structuredClone(value);
      },
    },
    {
      assistant: { name, avatarPath: null, avatarDataUrl: null },
    },
    createTestEntityReferences(),
  );
}
