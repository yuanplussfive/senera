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
  readonly rejectedToolNames: readonly string[];
}

export class AgentToolExposureState {
  private readonly authorizedToolNames: ReadonlySet<string>;
  private exposedToolNames: string[];
  private preferredToolNames: string[];
  private generation = 0;

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
    }

    return deepFreeze({
      snapshot: this.snapshot(),
      addedToolNames,
      rejectedToolNames,
    });
  }
}

function prioritize(requested: readonly string[], current: readonly string[], exposed: readonly string[]): string[] {
  const available = new Set(exposed);
  return normalizeAgentToolNames([...requested, ...current]).filter((toolName) => available.has(toolName));
}
