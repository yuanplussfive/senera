import type { AgentTemporalMemorySqliteStore } from "./AgentTemporalMemorySqliteStore.js";
import type {
  AgentTemporalMemoryDigest,
  AgentTemporalMemoryGranularity,
  AgentTemporalMemoryRange,
} from "./AgentTemporalMemoryTypes.js";
import { renderAgentTemporalMemoryDigest } from "./AgentTemporalMemoryPresentation.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";

export interface AgentTemporalMemoryRecallDigest {
  readonly digestRef: string;
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly status: AgentTemporalMemoryDigest["status"];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timeZone: string;
  readonly summary: string;
  readonly topics: readonly string[];
  readonly openLoops: readonly string[];
  readonly sourceRefs: readonly string[];
}

export interface AgentTemporalMemoryRecallResult {
  readonly digests: readonly AgentTemporalMemoryRecallDigest[];
  readonly coveredEpisodeUris: ReadonlySet<string>;
}

const GranularityOrder: readonly AgentTemporalMemoryGranularity[] = ["month", "day", "segment"];

/** Selects the coarsest complete temporal buckets while preserving an auditable path to physical episodes. */
export class AgentTemporalMemoryRecall {
  constructor(
    private readonly store: AgentTemporalMemorySqliteStore,
    private readonly identityDisplayValues?: () => AgentIdentityDisplayValues,
  ) {}

  read(input: {
    readonly scopeKey: string;
    readonly range?: AgentTemporalMemoryRange;
    readonly refs?: readonly string[];
  }): AgentTemporalMemoryRecallResult {
    const exact = this.store.digestsByUris(input.refs ?? []);
    const cover = input.range ? this.cover(input.scopeKey, input.range) : [];
    const selected = uniqueDigests([...exact, ...cover]);
    return {
      digests: selected.map((digest) => this.project(digest)),
      coveredEpisodeUris: new Set(
        selected.filter((digest) => digest.status === "sealed").flatMap((digest) => this.episodeUris(digest)),
      ),
    };
  }

  private cover(scopeKey: string, range: AgentTemporalMemoryRange): AgentTemporalMemoryDigest[] {
    const candidates = this.store.list(scopeKey, {
      statuses: ["sealed"],
      startMs: range.startMs,
      endMs: range.endMs,
    });
    const selected: AgentTemporalMemoryDigest[] = [];
    for (const granularity of GranularityOrder) {
      for (const candidate of candidates.filter((digest) => digest.granularity === granularity)) {
        if (!eligibleForRange(candidate, range)) continue;
        if (selected.some((parent) => containsDigest(parent, candidate))) continue;
        selected.push(candidate);
      }
    }
    return selected.sort(
      (left, right) =>
        left.periodStartMs - right.periodStartMs ||
        right.periodEndMs - left.periodEndMs ||
        GranularityOrder.indexOf(left.granularity) - GranularityOrder.indexOf(right.granularity),
    );
  }

  private project(digest: AgentTemporalMemoryDigest): AgentTemporalMemoryRecallDigest {
    const presented = this.identityDisplayValues
      ? renderAgentTemporalMemoryDigest(digest, this.identityDisplayValues())
      : digest;
    return {
      digestRef: presented.uri,
      granularity: presented.granularity,
      status: presented.status,
      periodStart: presented.periodStart,
      periodEnd: presented.periodEnd,
      timeZone: presented.timeZone,
      summary: presented.summary,
      topics: presented.topics,
      openLoops: presented.openLoops,
      sourceRefs: this.store.members(digest.id).map((member) => member.memberUri),
    };
  }

  private episodeUris(root: AgentTemporalMemoryDigest): string[] {
    const episodes = new Set<string>();
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const digest = pending.pop()!;
      if (visited.has(digest.uri)) continue;
      visited.add(digest.uri);
      for (const member of this.store.members(digest.id)) {
        if (member.memberKind === "episode") episodes.add(member.memberUri);
        else {
          const child = this.store.digestByUri(member.memberUri);
          if (!child) throw new Error(`Temporal digest references a missing child: ${member.memberUri}`);
          pending.push(child);
        }
      }
    }
    return [...episodes];
  }
}

function eligibleForRange(digest: AgentTemporalMemoryDigest, range: AgentTemporalMemoryRange): boolean {
  if (digest.granularity === "segment") {
    return digest.periodEndMs > range.startMs && digest.periodStartMs < range.endMs;
  }
  return digest.periodStartMs >= range.startMs && digest.periodEndMs <= range.endMs;
}

function containsDigest(parent: AgentTemporalMemoryDigest, child: AgentTemporalMemoryDigest): boolean {
  return parent.periodStartMs <= child.periodStartMs && parent.periodEndMs >= child.periodEndMs;
}

function uniqueDigests(digests: readonly AgentTemporalMemoryDigest[]): AgentTemporalMemoryDigest[] {
  return [...new Map(digests.map((digest) => [digest.uri, digest])).values()];
}
