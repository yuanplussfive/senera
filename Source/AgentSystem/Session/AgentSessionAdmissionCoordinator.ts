import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";

export interface AgentSessionAdmissionLifecycle {
  retain(sessionId: string): () => void;
}

export class AgentSessionAdmissionCoordinator {
  private readonly leases = new AgentKeyedLeaseQueue<string>();

  constructor(private readonly lifecycle?: AgentSessionAdmissionLifecycle) {}

  run<TValue>(sessionId: string, operation: () => Promise<TValue>): Promise<TValue> {
    return this.leases.run(sessionId, async () => {
      const releaseRetention = this.lifecycle?.retain(sessionId);
      try {
        return await operation();
      } finally {
        releaseRetention?.();
      }
    });
  }

  async runMany<TValue>(sessionIds: readonly string[], operation: () => Promise<TValue>): Promise<TValue> {
    const releases: Array<() => void> = [];
    const retentionReleases: Array<() => void> = [];
    const orderedIds = [...new Set(sessionIds)].sort((left, right) => left.localeCompare(right));
    try {
      for (const sessionId of orderedIds) releases.push(await this.leases.acquire(sessionId));
      for (const sessionId of orderedIds) {
        const releaseRetention = this.lifecycle?.retain(sessionId);
        if (releaseRetention) retentionReleases.push(releaseRetention);
      }
      return await operation();
    } finally {
      for (const release of retentionReleases.reverse()) release();
      for (const release of releases.reverse()) release();
    }
  }
}
