import crypto from "node:crypto";
import type { AgentTemporalMemoryIdentity, AgentTemporalMemoryScope } from "./AgentTemporalMemoryTypes.js";

export function projectAgentTemporalMemoryScope(identity: AgentTemporalMemoryIdentity): AgentTemporalMemoryScope {
  const values = [identity.workspaceId, identity.accountId ?? "", identity.userId ?? "", identity.worldId ?? ""];
  const hash = crypto.createHash("sha256");
  for (const value of values) {
    hash.update(value);
    hash.update("\0");
  }
  return {
    key: `temporal_scope_${hash.digest("hex").slice(0, 24)}`,
    workspaceId: requireIdentity(identity.workspaceId, "workspace"),
    accountId: optionalIdentity(identity.accountId),
    userId: optionalIdentity(identity.userId),
    worldId: optionalIdentity(identity.worldId),
  };
}

function requireIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Temporal memory ${label} identity must not be empty.`);
  return normalized;
}

function optionalIdentity(value: string | undefined): string | null {
  return value === undefined ? null : requireIdentity(value, "optional");
}
