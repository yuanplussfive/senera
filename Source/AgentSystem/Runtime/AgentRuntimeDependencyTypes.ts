import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export const AgentRuntimeDependencyStatusValues = ["checking", "installing", "ready", "unavailable", "failed"] as const;

export type AgentRuntimeDependencyStatus = (typeof AgentRuntimeDependencyStatusValues)[number];

export const AgentRuntimeDependencyKindValues = ["controller", "browser"] as const;

export type AgentRuntimeDependencyKind = (typeof AgentRuntimeDependencyKindValues)[number];

interface AgentRuntimeDependencyDescriptorBase {
  readonly id: string;
  readonly kind: AgentRuntimeDependencyKind;
  readonly displayName: AgentExtensionLocalizedText;
  readonly description: AgentExtensionLocalizedText;
  readonly capabilities: readonly string[];
}

export type AgentRuntimeDependencyDescriptor =
  | (AgentRuntimeDependencyDescriptorBase & {
      readonly installable: false;
      readonly installCommand?: never;
    })
  | (AgentRuntimeDependencyDescriptorBase & {
      readonly installable: true;
      readonly installCommand: readonly [string, ...string[]];
    });

export type AgentRuntimeDependencySnapshot = AgentRuntimeDependencyDescriptorBase & {
  readonly installable: boolean;
  readonly installCommand?: readonly string[];
  readonly status: AgentRuntimeDependencyStatus;
  readonly version?: string;
  readonly path?: string;
  readonly cachePath?: string;
  readonly cacheStatus?: "available" | "missing" | "unknown";
  readonly sizeBytes?: number;
  readonly phase?: string;
  readonly percent?: number;
  readonly transferredBytes?: number;
  readonly totalBytes?: number;
  readonly bytesPerSecond?: number;
  readonly message?: string;
  readonly checkedAt: string;
};

export interface AgentRuntimeDependencyProgress {
  readonly dependencyId: string;
  readonly snapshot: AgentRuntimeDependencySnapshot;
}

export interface AgentRuntimeDependencyHealthPolicy {
  /** Window mode used by an explicit health check, independent of user sessions. */
  readonly headed: boolean;
}

export const DefaultAgentRuntimeDependencyHealthPolicy = {
  headed: false,
} as const satisfies AgentRuntimeDependencyHealthPolicy;

export interface AgentRuntimeDependencyService {
  list(): Promise<readonly AgentRuntimeDependencySnapshot[]>;
  check(dependencyId: string): Promise<AgentRuntimeDependencySnapshot>;
  install(dependencyId: string, onProgress: (progress: AgentRuntimeDependencyProgress) => void): Promise<void>;
  close(): Promise<void>;
}
