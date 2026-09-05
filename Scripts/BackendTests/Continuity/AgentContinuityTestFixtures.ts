import type { AgentContinuityIdentityContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityIdentityStore.js";

export function testContinuityIdentity(id: string): AgentContinuityIdentityContext {
  return {
    workspaceId: id,
    accountId: id,
    userId: id,
    worldId: id,
    runtimeId: `${id}:runtime`,
  };
}
