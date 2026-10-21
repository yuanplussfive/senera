/** Reuses rendered stable prompt tiers while keeping volatile turn data out of the cache. */
export class AgentPromptTierRenderCache {
  private readonly stableEntries = new Map<string, Promise<string>>();

  async getOrRender(key: string, render: () => string | Promise<string>): Promise<string> {
    const existing = this.stableEntries.get(key);
    if (existing) return existing;

    const pending = Promise.resolve().then(render);
    this.stableEntries.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.stableEntries.get(key) === pending) this.stableEntries.delete(key);
      throw error;
    }
  }

  clear(): void {
    this.stableEntries.clear();
  }
}
