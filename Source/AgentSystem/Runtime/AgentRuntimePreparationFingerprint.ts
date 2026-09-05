import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

// Version 3 invalidates snapshots created before request-scoped Tool authorization ceilings were authoritative.
const AgentRuntimePreparationFingerprintVersion = 3;

export function createAgentRuntimePreparationFingerprint(input: {
  config: AgentSystemConfig;
  modelProviderId?: string;
  sourceRevisions?: Readonly<Record<string, string | number>>;
}): string {
  const digest = sha256HexOfCanonicalJson({
    version: AgentRuntimePreparationFingerprintVersion,
    modelProviderId: input.modelProviderId?.trim() || null,
    sourceRevisions: input.sourceRevisions ?? {},
    config: input.config,
  });
  return `preparation-v${AgentRuntimePreparationFingerprintVersion}:${digest}`;
}
