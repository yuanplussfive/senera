import path from "node:path";
import { sha256Hex } from "../Core/AgentHash.js";

export interface AgentManagedBrowserProfileLease {
  endpoint(): Promise<AgentManagedBrowserEndpoint>;
  release(): Promise<void>;
}

interface AgentManagedBrowserEndpoint {
  readonly cdpUrl: string;
}

interface AgentManagedBrowserProfileOptions {
  readonly profileDirectory: string;
  readonly launchIdentity: string;
  probe(cdpUrl: string): Promise<boolean>;
  open(): Promise<string>;
  close(): Promise<void>;
}

/**
 * One coordinator lives for each application-owned profile path in this host
 * process. Retaining an inactive coordinator prevents a new launch racing an
 * in-flight close against Chromium's profile lock.
 */
const managedBrowserProfiles = new Map<string, AgentManagedBrowserProfile>();
const managedBrowserTabMutations = new Map<string, Promise<void>>();

class AgentManagedBrowserProfile {
  private opening: Promise<string> | undefined;
  private checking: Promise<AgentManagedBrowserEndpoint> | undefined;
  private cdpUrl: string | undefined;
  private references = 0;
  private closing: Promise<void> | undefined;

  constructor(private options: AgentManagedBrowserProfileOptions) {}

  async acquire(candidate: AgentManagedBrowserProfileOptions): Promise<AgentManagedBrowserProfileLease> {
    if (this.closing) await this.closing;
    if (this.references === 0 && !this.cdpUrl && !this.opening) this.options = candidate;
    if (candidate.launchIdentity !== this.options.launchIdentity) {
      throw new Error(
        "The Senera browser that remembers sign-ins is already active with different launch settings. Close its active sessions before changing browser launch settings.",
      );
    }
    this.references += 1;
    try {
      await this.liveEndpoint();
      let released = false;
      return {
        endpoint: () => this.liveEndpoint(),
        release: async () => {
          if (released) return;
          released = true;
          await this.release();
        },
      };
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  private liveEndpoint(): Promise<AgentManagedBrowserEndpoint> {
    const checking = this.checking ?? this.checkEndpoint();
    this.checking = checking;
    return checking.finally(() => {
      if (this.checking === checking) this.checking = undefined;
    });
  }

  private async checkEndpoint(): Promise<AgentManagedBrowserEndpoint> {
    if (this.cdpUrl && (await this.options.probe(this.cdpUrl))) {
      return { cdpUrl: this.cdpUrl };
    }
    // The leased browser is gone (window closed or crash). Drop the stale
    // endpoint and relaunch instead of sending every command to a closed port.
    this.cdpUrl = undefined;
    this.opening = undefined;
    return { cdpUrl: await this.endpoint() };
  }

  private endpoint(): Promise<string> {
    if (this.cdpUrl) return Promise.resolve(this.cdpUrl);
    const opening = this.opening ?? this.options.open();
    this.opening = opening;
    return opening.then(
      (cdpUrl) => {
        this.cdpUrl = cdpUrl;
        return cdpUrl;
      },
      (error) => {
        if (this.opening === opening) this.opening = undefined;
        throw error;
      },
    );
  }

  private async release(): Promise<void> {
    this.references = Math.max(0, this.references - 1);
    if (this.references > 0) return;
    if (!this.cdpUrl && !this.opening) return;
    const closing = this.closing ?? this.options.close();
    this.closing = closing;
    try {
      await closing;
    } finally {
      if (this.closing === closing) {
        this.cdpUrl = undefined;
        this.opening = undefined;
        this.closing = undefined;
      }
    }
  }
}

export function acquireAgentManagedBrowserProfile(
  options: AgentManagedBrowserProfileOptions,
): Promise<AgentManagedBrowserProfileLease> {
  const key = path.resolve(options.profileDirectory);
  let profile = managedBrowserProfiles.get(key);
  if (!profile) {
    profile = new AgentManagedBrowserProfile(options);
    managedBrowserProfiles.set(key, profile);
  }
  return profile.acquire(options);
}

export async function serializeManagedBrowserTabMutation<TValue>(
  profileDirectory: string,
  operation: () => Promise<TValue>,
): Promise<TValue> {
  const key = path.resolve(profileDirectory);
  const predecessor = managedBrowserTabMutations.get(key) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = predecessor.catch(() => undefined).then(() => completion);
  managedBrowserTabMutations.set(key, queued);
  try {
    await predecessor.catch(() => undefined);
    return await operation();
  } finally {
    release();
    if (managedBrowserTabMutations.get(key) === queued) managedBrowserTabMutations.delete(key);
  }
}

export function managedBrowserOwnerSessionId(profileDirectory: string): string {
  return `senera-managed-browser-${sha256Hex(path.resolve(profileDirectory)).slice(0, 32)}`;
}
