import { AgentRunEventHistoryReplayChunkSize } from "../Events/AgentRunEventHistoryPolicy.js";

export const AgentSessionHistoryEntryReplayChunkSize = 50;

export const AgentSessionRepositoryPagingPolicy = Object.freeze({
  maximumPageSize: 1_024,
});

export interface AgentSessionHistoryReplayPaging {
  readonly entryPageSize: number;
  readonly stepRunPageSize: number;
  readonly runEventPageSize: number;
}

export const AgentSessionHistoryReplayPagingDefaults: AgentSessionHistoryReplayPaging = Object.freeze({
  entryPageSize: AgentSessionHistoryEntryReplayChunkSize,
  stepRunPageSize: 64,
  runEventPageSize: AgentRunEventHistoryReplayChunkSize,
});

export function resolveAgentSessionHistoryReplayPaging(
  input: Partial<AgentSessionHistoryReplayPaging> = {},
): AgentSessionHistoryReplayPaging {
  return Object.freeze({
    entryPageSize: assertAgentSessionRepositoryPageSize(
      input.entryPageSize ?? AgentSessionHistoryReplayPagingDefaults.entryPageSize,
    ),
    stepRunPageSize: assertAgentSessionRepositoryPageSize(
      input.stepRunPageSize ?? AgentSessionHistoryReplayPagingDefaults.stepRunPageSize,
    ),
    runEventPageSize: assertAgentSessionRepositoryPageSize(
      input.runEventPageSize ?? AgentSessionHistoryReplayPagingDefaults.runEventPageSize,
    ),
  });
}

export function assertAgentSessionRepositoryPageSize(pageSize: number): number {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > AgentSessionRepositoryPagingPolicy.maximumPageSize
  ) {
    throw new RangeError(
      `Session repository page size must be an integer between 1 and ${AgentSessionRepositoryPagingPolicy.maximumPageSize}.`,
    );
  }
  return pageSize;
}

export function normalizeAgentSessionRequestIds(requestIds: readonly string[]): string[] {
  if (requestIds.length > AgentSessionRepositoryPagingPolicy.maximumPageSize) {
    throw new RangeError(
      `Session repository request lookup cannot exceed ${AgentSessionRepositoryPagingPolicy.maximumPageSize} IDs.`,
    );
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const requestId of requestIds) {
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new TypeError("Session repository request IDs must be non-empty strings.");
    }
    if (seen.has(requestId)) continue;
    seen.add(requestId);
    normalized.push(requestId);
  }
  return normalized;
}
