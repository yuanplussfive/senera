import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import {
  hasSameAgentToolNameSequence,
  normalizeAgentToolNames,
  type AgentToolAccessGrant,
} from "./AgentToolAccessGrant.js";

export interface AgentToolExposureSnapshot {
  readonly generation: number;
  readonly exposedToolNames: readonly string[];
  readonly preferredToolNames: readonly string[];
}

export interface AgentToolExposureDelta {
  readonly snapshot: AgentToolExposureSnapshot;
  readonly addedToolNames: readonly string[];
  readonly removedToolNames: readonly string[];
  readonly rejectedToolNames: readonly string[];
  readonly protectedToolNames: readonly string[];
}

export class AgentToolExposureState {
  private readonly authorizedToolNames: ReadonlySet<string>;
  private exposedToolNames: string[];
  private preferredToolNames: string[];
  private generation = 0;
  private readonly listeners = new Set<(snapshot: AgentToolExposureSnapshot) => void>();

  constructor(grant: AgentToolAccessGrant) {
    this.authorizedToolNames = new Set(grant.authorizedToolNames);
    this.exposedToolNames = [...grant.exposedToolNames];
    this.preferredToolNames = [...grant.preferredToolNames];
  }

  snapshot(): AgentToolExposureSnapshot {
    return deepFreeze({
      generation: this.generation,
      exposedToolNames: [...this.exposedToolNames],
      preferredToolNames: [...this.preferredToolNames],
    });
  }

  exposes(toolName: string): boolean {
    return this.exposedToolNames.includes(toolName);
  }

  subscribe(listener: (snapshot: AgentToolExposureSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  expose(toolNames: readonly string[]): AgentToolExposureDelta {
    const requested = normalizeAgentToolNames(toolNames);
    const accepted = requested.filter((toolName) => this.authorizedToolNames.has(toolName));
    const rejectedToolNames = requested.filter((toolName) => !this.authorizedToolNames.has(toolName));
    const exposed = new Set(this.exposedToolNames);
    const addedToolNames = accepted.filter((toolName) => !exposed.has(toolName));
    const nextExposedToolNames = [...this.exposedToolNames, ...addedToolNames];
    const nextPreferredToolNames = prioritize(accepted, this.preferredToolNames, nextExposedToolNames);
    const stateChanged =
      addedToolNames.length > 0 || !hasSameAgentToolNameSequence(this.preferredToolNames, nextPreferredToolNames);

    if (stateChanged) {
      this.exposedToolNames = nextExposedToolNames;
      this.preferredToolNames = nextPreferredToolNames;
      this.generation += 1;
      this.publish();
    }

    return deepFreeze({
      snapshot: this.snapshot(),
      addedToolNames,
      removedToolNames: [],
      rejectedToolNames,
      protectedToolNames: [],
    });
  }

  revoke(
    toolNames: readonly string[],
    options: { protectedToolNames?: readonly string[] } = {},
  ): AgentToolExposureDelta {
    const requested = normalizeAgentToolNames(toolNames);
    const protectedNames = new Set(normalizeAgentToolNames(options.protectedToolNames ?? []));
    const exposed = new Set(this.exposedToolNames);
    const protectedToolNames = requested.filter((toolName) => protectedNames.has(toolName));
    const rejectedToolNames = requested.filter(
      (toolName) => !this.authorizedToolNames.has(toolName) || !exposed.has(toolName),
    );
    const removedToolNames = requested.filter(
      (toolName) => this.authorizedToolNames.has(toolName) && exposed.has(toolName) && !protectedNames.has(toolName),
    );
    const removed = new Set(removedToolNames);
    const nextExposedToolNames = this.exposedToolNames.filter((toolName) => !removed.has(toolName));
    const nextPreferredToolNames = this.preferredToolNames.filter((toolName) => !removed.has(toolName));

    if (removedToolNames.length > 0) {
      this.exposedToolNames = nextExposedToolNames;
      this.preferredToolNames = nextPreferredToolNames;
      this.generation += 1;
      this.publish();
    }

    return deepFreeze({
      snapshot: this.snapshot(),
      addedToolNames: [],
      removedToolNames,
      rejectedToolNames,
      protectedToolNames,
    });
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function prioritize(requested: readonly string[], current: readonly string[], exposed: readonly string[]): string[] {
  const available = new Set(exposed);
  return normalizeAgentToolNames([...requested, ...current]).filter((toolName) => available.has(toolName));
}
