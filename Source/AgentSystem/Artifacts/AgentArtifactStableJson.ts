import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { sha256Hex } from "../Core/AgentHash.js";

export function stableArtifactHash(value: unknown): string {
  return sha256Hex(stableArtifactStringify(value));
}

export function stableArtifactStringify(value: unknown): string {
  return value === undefined ? "undefined" : stringifyAgentCanonicalJson(value);
}
