import type { AgentConfigReplaceInput, AgentConfigSnapshot } from "../Config/AgentConfigService.js";
import type { AgentConfigHistoryEntry } from "../Config/AgentConfigService.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import type { AgentPresetSnapshot } from "../Presets/AgentPresetTypes.js";
import type { AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentRuntimeManifest } from "../Runtime/AgentRuntimeManifest.js";
import type { AgentPluginListEntry } from "../Plugins/AgentPluginTypes.js";
import type {
  AgentEffectiveModelReceipt,
  AgentSessionModelPreference,
  AgentSessionModelPreferenceMutationResult,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSessionSnapshot } from "../Session/AgentSession.js";
import type { AgentSkillResourceDescriptor, AgentSkillResourceRead } from "../Skills/AgentSkillScanner.js";

export interface AgentSelfSkillSource {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "system" | "workspace";
  readonly root: string;
}

export interface AgentSelfSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly descriptionFile: string;
  readonly source: Pick<AgentSelfSkillSource, "id" | "displayName" | "kind">;
  readonly revision?: string;
  readonly recommendedTools: readonly string[];
  /** When true, the Skill remains explicitly addressable but is excluded from
   * automatic model routing. This mirrors the Skill package contract rather
   * than hiding the Skill from host diagnostics. */
  readonly disableModelInvocation?: boolean;
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly resourceCount?: number;
}

export interface AgentSelfSkillSearchMatch {
  readonly skill: AgentSelfSkillSummary;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly matchedFields: readonly { readonly term: string; readonly fields: readonly string[] }[];
}

export type AgentSelfSkillResourceListing =
  | {
      readonly status: "found";
      readonly skill: AgentSelfSkillSummary;
      readonly resources: readonly AgentSkillResourceDescriptor[];
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "ambiguous"; readonly error: string; readonly candidates: readonly AgentSelfSkillSummary[] }
  | { readonly status: "invalid"; readonly error: string; readonly skill: AgentSelfSkillSummary };

export type AgentSelfSkillResourceRead =
  | {
      readonly status: "found";
      readonly skill: AgentSelfSkillSummary;
      readonly revision: string;
      readonly resource: AgentSkillResourceRead;
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "ambiguous"; readonly error: string; readonly candidates: readonly AgentSelfSkillSummary[] }
  | { readonly status: "invalid"; readonly error: string; readonly skill: AgentSelfSkillSummary }
  | { readonly status: "stale"; readonly expectedRevision: string; readonly actualRevision: string };

export interface AgentSelfSkillDiffEntry {
  readonly path: string;
  readonly kind: "added" | "removed" | "changed" | "unchanged";
  readonly before?: AgentSkillResourceDescriptor;
  readonly after?: AgentSkillResourceDescriptor;
}

export type AgentSelfSkillDiff =
  | {
      readonly status: "found";
      readonly skill: AgentSelfSkillSummary;
      readonly currentRevision: string;
      readonly comparedRevision: string;
      readonly entries: readonly AgentSelfSkillDiffEntry[];
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "ambiguous"; readonly error: string; readonly candidates: readonly AgentSelfSkillSummary[] }
  | { readonly status: "invalid"; readonly error: string; readonly skill: AgentSelfSkillSummary };

export type AgentSelfSkillInspection =
  | {
      readonly status: "found";
      readonly skill: AgentSelfSkillSummary;
      readonly content: string;
      readonly resources?: readonly AgentSkillResourceDescriptor[];
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "ambiguous"; readonly error: string; readonly candidates: readonly AgentSelfSkillSummary[] };

export interface AgentSelfSkillCheckReport {
  readonly checkedAt: string;
  readonly valid: boolean;
  readonly skills: readonly AgentSelfSkillSummary[];
  readonly issues: readonly string[];
}

export interface AgentSelfSkillHistoryEntry {
  readonly revision: string;
  readonly action: "update" | "archive";
  readonly createdAt: string;
  readonly sourceRevision: string;
}

export type AgentSelfSkillMutationResult =
  | {
      readonly status: "created" | "updated" | "restored";
      readonly skill: AgentSelfSkillSummary;
      readonly revision: string;
      readonly previousRevision?: string;
      readonly restoredFrom?: string;
    }
  | {
      readonly status: "archived";
      readonly name: string;
      readonly revision: string;
    }
  | { readonly status: "exists"; readonly name: string; readonly revision?: string }
  | { readonly status: "missing"; readonly name: string }
  | {
      readonly status: "conflict";
      readonly name: string;
      readonly expectedRevision: string;
      readonly actualRevision?: string;
    }
  | { readonly status: "invalid"; readonly name: string; readonly issues: readonly string[] }
  | { readonly status: "failed"; readonly name: string; readonly error: string }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Host services the senera self-service commands need. The same command
 * vocabulary powers the model-facing `SeneraCommand` host tool and the
 * human-facing `senera` CLI; both dispatch through this port on the live
 * service process, so every command is revision-guarded, validated, and
 * broadcast to the frontend. There is no standalone file-writing path.
 */
export interface AgentSelfServicePort {
  readonly workspaceRoot: string;
  /** Absolute path of the active configuration file, for `senera config env-path`. */
  readonly configPath?: string;
  readonly config: {
    getSnapshot(): AgentConfigSnapshot;
    replace(input: AgentConfigReplaceInput): AgentConfigSnapshot;
    /** Retained revision metadata for `senera config history`. Empty when the
     * configuration store is disabled — never a silent approximation. */
    history(): readonly AgentConfigHistoryEntry[];
    /** One retained revision for `senera config rollback` adjudication. */
    readRevision(revision: number): AgentSelfConfigRevisionReadResult;
  };
  readonly presets: {
    manager(): AgentPresetManager;
  };
  readonly sessions?: {
    /** Recent session catalog for `senera sessions list`. */
    list(): readonly AgentSelfSessionSummary[];
    /** Reads the durable next-turn model preference for one session. */
    getModelPreference(sessionId: string): AgentSessionModelPreference | undefined;
    /** Runtime-authoritative model state: active turn, preference, and last run. */
    getModelRuntime(sessionId: string): AgentSessionModelRuntime | undefined;
    /** Validates and persists a durable next-turn model preference. */
    setModelPreference(
      sessionId: string,
      modelProviderId: string,
      source?: "user" | "agent" | "channel",
    ): Promise<AgentSessionModelPreferenceMutationResult>;
    /** Snapshot used to publish an immediate session update after a mutation. */
    snapshot(sessionId: string): AgentSessionSnapshot | undefined;
  };
  readonly status?: {
    /** Live service manifest for `senera status`; undefined when the host has
     * no manifest store bound. */
    manifest(): AgentRuntimeManifest | undefined;
  };
  readonly logs?: {
    root(): string;
    list(): readonly AgentSelfLogFile[];
    /** Reads the trailing lines of one log file. Rejects names that resolve
     * outside the log root. */
    read(name: string, lines: number): AgentSelfLogReadResult;
  };
  readonly plugins?: {
    /** Discovered plugins with whitelist-derived enablement and load status. */
    list(): readonly AgentPluginListEntry[];
    /** Manifest-level discovery errors (invalid JSON, duplicate ids). */
    discoveryErrors(): readonly { readonly pluginId?: string; readonly message: string }[];
  };
  readonly skills?: {
    /** Lists system and workspace Skills with source and validation state. */
    list(): readonly AgentSelfSkillSummary[];
    /** Finds bounded Skill metadata without loading full Skill bodies. */
    search?(query: string, limit?: number): readonly AgentSelfSkillSearchMatch[];
    /** Reads one uniquely resolved Skill document without exposing arbitrary paths. */
    inspect(name: string): AgentSelfSkillInspection;
    /** Lists all non-hidden resources in one uniquely resolved Skill package. */
    resources(name: string): AgentSelfSkillResourceListing;
    /** Reads one package resource with an optional revision guard. */
    readResource(name: string, relativePath: string, expectedRevision?: string): AgentSelfSkillResourceRead;
    /** Compares the active package with a retained revision. */
    diff(name: string, revision: string): AgentSelfSkillDiff;
    /** Validates all Skills, or one named Skill when provided. */
    check(name?: string): AgentSelfSkillCheckReport;
    /** Creates a new workspace Skill from a complete SKILL.md document. */
    create(name: string, content: string): AgentSelfSkillMutationResult;
    /** Replaces the SKILL.md document after validating the current revision. */
    update(name: string, content: string, expectedRevision?: string): AgentSelfSkillMutationResult;
    /** Moves a workspace Skill into its revisioned archive. */
    archive(name: string, expectedRevision?: string): AgentSelfSkillMutationResult;
    /** Restores an archived revision into the active workspace Skill root. */
    restore(name: string, revision: string): AgentSelfSkillMutationResult;
    /** Lists retained workspace revisions for one Skill, newest first. */
    history(name: string): readonly AgentSelfSkillHistoryEntry[];
  };
  readonly slice?: {
    readonly layout: AgentWorkspaceLayout;
    readonly deployedModes: readonly { readonly name: string; readonly kind: string }[];
  };
}

export interface AgentSessionModelRuntime {
  readonly active?: AgentEffectiveModelReceipt;
  readonly effective?: AgentEffectiveModelReceipt;
  readonly preference?: AgentSessionModelPreference;
  readonly lastRun?: AgentEffectiveModelReceipt;
}

export type AgentSelfConfigRevisionReadResult =
  | { readonly status: "found"; readonly value: AgentSystemConfig }
  | { readonly status: "unavailable" }
  | { readonly status: "missing" };

export type AgentSelfCommand =
  | { readonly command: "config"; readonly action: "get"; readonly path?: string }
  | { readonly command: "config"; readonly action: "models" }
  | { readonly command: "config"; readonly action: "endpoints" }
  | { readonly command: "config"; readonly action: "update"; readonly path: string; readonly value: unknown }
  | { readonly command: "config"; readonly action: "history" }
  | { readonly command: "config"; readonly action: "env-path" }
  | { readonly command: "config"; readonly action: "check" }
  | { readonly command: "config"; readonly action: "rollback"; readonly revision: number }
  | { readonly command: "preset"; readonly action: "list" }
  | { readonly command: "preset"; readonly action: "show"; readonly name: string }
  | { readonly command: "preset"; readonly action: "use"; readonly name: string | null }
  | {
      readonly command: "preset";
      readonly action: "create";
      readonly name: string;
      readonly content: unknown;
    }
  | { readonly command: "workspace"; readonly action: "info" }
  | { readonly command: "sessions"; readonly action: "list" }
  | {
      readonly command: "session";
      readonly action: "model";
      readonly operation: "get" | "set";
      readonly modelProviderId?: string;
      readonly sessionId?: string;
    }
  | { readonly command: "plugins"; readonly action: "list" }
  | { readonly command: "skills"; readonly action: "list" }
  | { readonly command: "skills"; readonly action: "search"; readonly query: string; readonly limit?: number }
  | { readonly command: "skills"; readonly action: "inspect"; readonly name: string }
  | { readonly command: "skills"; readonly action: "resources"; readonly name: string }
  | {
      readonly command: "skills";
      readonly action: "read";
      readonly name: string;
      readonly path: string;
      readonly revision?: string;
    }
  | { readonly command: "skills"; readonly action: "diff"; readonly name: string; readonly revision: string }
  | { readonly command: "skills"; readonly action: "check"; readonly name?: string }
  | { readonly command: "skills"; readonly action: "history"; readonly name: string }
  | { readonly command: "skills"; readonly action: "create"; readonly name: string; readonly content: string }
  | {
      readonly command: "skills";
      readonly action: "update";
      readonly name: string;
      readonly content: string;
      readonly expectedRevision: string;
    }
  | { readonly command: "skills"; readonly action: "archive"; readonly name: string; readonly expectedRevision: string }
  | { readonly command: "skills"; readonly action: "restore"; readonly name: string; readonly revision: string }
  | { readonly command: "capabilities" }
  | { readonly command: "logs"; readonly action: "list" }
  | { readonly command: "logs"; readonly action: "tail"; readonly name: string; readonly lines?: number }
  | { readonly command: "status" }
  | { readonly command: "doctor"; readonly action: "status" }
  | {
      readonly command: "approval";
      readonly action: "resolve";
      readonly approvalId: string;
      readonly decision: "approve" | "deny";
    };

export interface AgentSelfPluginCommand {
  readonly command: string;
  readonly action?: string;
  readonly args?: readonly string[];
}

export type AgentSelfInvocation = AgentSelfCommand | AgentSelfPluginCommand;

export interface AgentSelfCommandOutput {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: unknown;
  readonly error?: string;
  /** Present when a sensitive update needs a human decision and none was
   * supplied yet; the CLI uses this to run its terminal handshake. */
  readonly approvalRequired?: {
    readonly approvalId: string;
    readonly command: AgentSelfCommand;
    readonly reason: string;
    readonly deadlineAt: string;
  };
}

export interface AgentSelfPresetSummary {
  readonly name: string;
  readonly title: string;
  readonly active: boolean;
  readonly sizeBytes: number;
  readonly updatedAt?: string;
}

export interface AgentSelfWorkspaceInfo {
  readonly root: string;
  readonly stateRoot: string;
  readonly dataRoot: string;
  readonly skillRoot: string;
  readonly mcpRoot: string;
  readonly databases: Readonly<Record<string, string>>;
  readonly deployed: readonly { readonly name: string; readonly kind: string }[];
}

export interface AgentSelfDoctorReport {
  readonly config: { readonly valid: boolean; readonly revision?: number; readonly issues: readonly string[] };
  readonly workspace: { readonly writable: boolean; readonly issues: readonly string[] };
  readonly state: { readonly readonly: boolean; readonly issues: readonly string[] };
}

export interface AgentSelfSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly entryCount: number;
  readonly updatedAt?: string;
  readonly modelProviderId?: string;
}

export interface AgentSelfLogFile {
  readonly name: string;
  readonly sizeBytes: number;
  readonly updatedAt?: string;
}

export type AgentSelfLogReadResult =
  | { readonly status: "found"; readonly content: string }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "rejected"; readonly error: string };

export type { AgentPresetSnapshot };
