export class AgentSessionApprovalLeaseStore {
  private readonly leases = new Map<string, Set<string>>();

  has(sessionId: string, capabilityDigest: string): boolean {
    return this.leases.get(sessionId)?.has(capabilityDigest) ?? false;
  }

  grant(sessionId: string, capabilityDigest: string): void {
    const sessionLeases = this.leases.get(sessionId) ?? new Set<string>();
    sessionLeases.add(capabilityDigest);
    this.leases.set(sessionId, sessionLeases);
  }

  revoke(sessionId: string): boolean {
    return this.leases.delete(sessionId);
  }

  clear(): void {
    this.leases.clear();
  }
}
