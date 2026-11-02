/** Owns invalidation of asynchronous work when a native conversation is cleared. */
export class AgentChannelConversationGuard {
  private readonly revisions = new Map<string, number>();
  private readonly clearing = new Set<string>();

  isClearing(key: string): boolean {
    return this.clearing.has(key);
  }

  capture(key: string): () => boolean {
    const revision = this.revisions.get(key) ?? 0;
    return () => !this.clearing.has(key) && (this.revisions.get(key) ?? 0) === revision;
  }

  async clear(key: string, operation: () => Promise<void>): Promise<boolean> {
    if (this.clearing.has(key)) return false;
    this.clearing.add(key);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    try {
      await operation();
      return true;
    } finally {
      this.clearing.delete(key);
    }
  }
}
