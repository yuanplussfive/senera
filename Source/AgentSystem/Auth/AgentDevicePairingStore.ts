import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PairingLifetimeMs = 5 * 60_000;

interface Pairing {
  readonly id: string;
  readonly codeDigest: Buffer;
  readonly ownerSessionId: string;
  readonly expiresAt: number;
  claim?: { deviceName: string; secretDigest: Buffer };
  approved: boolean;
}

/** Pairing secrets never become a device session until its owner explicitly approves the claim. */
export class AgentDevicePairingStore {
  private readonly pairings = new Map<string, Pairing>();

  constructor(
    private readonly options: {
      maxPairings: number;
      isOwnerActive: (sessionId: string) => boolean;
      now?: () => number;
    },
  ) {}

  create(ownerSessionId: string): { pairingId: string; code: string; expiresAt: string } | undefined {
    this.prune();
    // Replacing the owner's displayed code invalidates previous unapproved codes.
    // An approved claim stays valid until the phone exchanges it; deleting it here
    // would make the phone's pending exchange fail after the owner approves.
    for (const [id, pairing] of this.pairings) {
      if (pairing.ownerSessionId === ownerSessionId && !pairing.approved) this.pairings.delete(id);
    }
    if (this.pairings.size >= this.options.maxPairings) return undefined;
    const id = randomBytes(24).toString("base64url");
    const code = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + PairingLifetimeMs;
    this.pairings.set(id, { id, codeDigest: digest(code), ownerSessionId, expiresAt, approved: false });
    return { pairingId: id, code, expiresAt: new Date(expiresAt).toISOString() };
  }

  claim(id: string, code: string, deviceName: string, secret: string): boolean {
    this.prune();
    const pairing = this.pairings.get(id);
    if (!pairing || pairing.claim || !matches(pairing.codeDigest, code)) return false;
    pairing.claim = { deviceName, secretDigest: digest(secret) };
    return true;
  }

  pending(ownerSessionId: string): Array<{ pairingId: string; deviceName: string; expiresAt: string }> {
    this.prune();
    return [...this.pairings.values()].flatMap((pairing) =>
      pairing.ownerSessionId === ownerSessionId && pairing.claim && !pairing.approved
        ? [
            {
              pairingId: pairing.id,
              deviceName: pairing.claim.deviceName,
              expiresAt: new Date(pairing.expiresAt).toISOString(),
            },
          ]
        : [],
    );
  }

  decide(id: string, ownerSessionId: string, approve: boolean): boolean {
    this.prune();
    const pairing = this.pairings.get(id);
    if (!pairing?.claim || pairing.ownerSessionId !== ownerSessionId) return false;
    if (approve) pairing.approved = true;
    else this.pairings.delete(id);
    return true;
  }

  exchange(
    id: string,
    secret: string,
  ): { state: "pending" } | { state: "approved"; deviceName: string; ownerSessionId: string } | undefined {
    this.prune();
    const pairing = this.pairings.get(id);
    if (!pairing?.claim || !matches(pairing.claim.secretDigest, secret)) return undefined;
    if (!pairing.approved) return { state: "pending" };
    this.pairings.delete(id);
    return { state: "approved", deviceName: pairing.claim.deviceName, ownerSessionId: pairing.ownerSessionId };
  }

  private prune(): void {
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt <= this.now() || !this.options.isOwnerActive(pairing.ownerSessionId)) {
        this.pairings.delete(id);
      }
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function matches(expected: Buffer, value: string): boolean {
  return timingSafeEqual(expected, digest(value));
}
