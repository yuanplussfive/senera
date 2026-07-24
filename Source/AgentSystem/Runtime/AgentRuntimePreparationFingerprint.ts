import crypto from "node:crypto";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";

const AgentRuntimePreparationFingerprintVersion = 1;

export function createAgentRuntimePreparationFingerprint(input: {
  config: AgentSystemConfig;
  modelProviderId?: string;
  sourceRevisions?: Readonly<Record<string, string | number>>;
}): string {
  const payload = stringifyAgentCanonicalJson({
    version: AgentRuntimePreparationFingerprintVersion,
    modelProviderId: input.modelProviderId?.trim() || null,
    sourceRevisions: input.sourceRevisions ?? {},
    config: input.config,
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `preparation-v${AgentRuntimePreparationFingerprintVersion}:${digest}`;
}
