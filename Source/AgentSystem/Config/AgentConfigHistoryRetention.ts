import type { ResolvedAgentConfigStoreConfig } from "../Types/AgentConfigTypes.js";

export interface AgentConfigHistoryRetentionPolicy {
  readonly revisionRetentionCount: number;
  readonly commandReceiptRetentionHours: number;
  readonly commandReceiptMaxCount: number;
}

export function projectAgentConfigHistoryRetentionPolicy(
  config: ResolvedAgentConfigStoreConfig,
): AgentConfigHistoryRetentionPolicy {
  return Object.freeze({
    revisionRetentionCount: config.RevisionRetentionCount,
    commandReceiptRetentionHours: config.CommandReceiptRetentionHours,
    commandReceiptMaxCount: config.CommandReceiptMaxCount,
  });
}

export function assertAgentConfigHistoryRetentionPolicy(
  policy: AgentConfigHistoryRetentionPolicy,
): AgentConfigHistoryRetentionPolicy {
  assertPositiveSafeInteger(policy.revisionRetentionCount, "revisionRetentionCount");
  assertPositiveSafeInteger(policy.commandReceiptRetentionHours, "commandReceiptRetentionHours");
  assertPositiveSafeInteger(policy.commandReceiptMaxCount, "commandReceiptMaxCount");
  return policy;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}
