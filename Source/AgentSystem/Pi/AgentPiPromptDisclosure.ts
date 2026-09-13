import type { Skill } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { readAgentUnknownRecord, readAgentString } from "../Core/AgentUnknownValue.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type { AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";

export const AgentPiPromptDisclosureStateVersion = 1 as const;

export interface AgentPiPromptDisclosureState {
  readonly version: typeof AgentPiPromptDisclosureStateVersion;
  readonly skillKeys: readonly string[];
  readonly promptTemplateKeys: readonly string[];
}

export interface AgentPiPromptDisclosureReadResult {
  readonly state: AgentPiPromptDisclosureState;
  readonly invalidEntryId?: string;
}

/**
 * A per-session ledger for prompt resources that have already been disclosed
 * to Pi. The in-memory view is restored from a compact custom checkpoint, so
 * pool eviction and process restarts do not turn an intact transcript into a
 * needless full-resource disclosure.
 */
export interface AgentPiPromptDisclosurePlan {
  readonly newSkills: readonly Skill[];
  readonly reusedSkills: readonly AgentPiSkillDisclosureReference[];
  readonly newPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  readonly reusedPromptTemplates: readonly AgentPiPromptTemplateDisclosureReference[];
  readonly skillKeys: readonly string[];
  readonly promptTemplateKeys: readonly string[];
}

export interface AgentPiSkillDisclosureReference {
  readonly kind: "skill";
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly state: "active-reference";
  readonly revision: string;
}

export interface AgentPiPromptTemplateDisclosureReference {
  readonly kind: "prompt-template";
  readonly name: string;
  readonly description?: string;
  readonly state: "active-reference";
  readonly revision: string;
  readonly resourceKinds: readonly string[];
  readonly workflowRoles: readonly string[];
}

export class AgentPiPromptDisclosureLedger {
  private readonly skillKeys = new Set<string>();
  private readonly promptTemplateKeys = new Set<string>();

  plan(input: {
    readonly skills: readonly Skill[];
    readonly selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  }): AgentPiPromptDisclosurePlan {
    const skillEntries = input.skills.map((skill) => ({
      skill,
      key: agentPiSkillDisclosureKey(skill),
    }));
    const templateEntries = input.selectedPromptTemplates.map((template) => ({
      template,
      key: agentPiPromptTemplateDisclosureKey(template),
    }));

    return {
      newSkills: skillEntries.filter(({ key }) => !this.skillKeys.has(key)).map(({ skill }) => skill),
      reusedSkills: skillEntries
        .filter(({ key }) => this.skillKeys.has(key))
        .map(({ skill, key }) => ({
          kind: "skill" as const,
          name: skill.name,
          description: skill.description,
          location: skill.filePath,
          state: "active-reference" as const,
          revision: disclosureDigest(key),
        })),
      newPromptTemplates: templateEntries
        .filter(({ key }) => !this.promptTemplateKeys.has(key))
        .map(({ template }) => template),
      reusedPromptTemplates: templateEntries
        .filter(({ key }) => this.promptTemplateKeys.has(key))
        .map(({ template, key }) => ({
          kind: "prompt-template" as const,
          name: template.name,
          ...(template.description ? { description: template.description } : {}),
          state: "active-reference" as const,
          revision: disclosureDigest(key),
          resourceKinds: template.resourceKinds,
          workflowRoles: template.workflowRoles,
        })),
      skillKeys: skillEntries.map(({ key }) => key),
      promptTemplateKeys: templateEntries.map(({ key }) => key),
    };
  }

  commit(plan: AgentPiPromptDisclosurePlan): void {
    plan.skillKeys.forEach((key) => this.skillKeys.add(key));
    plan.promptTemplateKeys.forEach((key) => this.promptTemplateKeys.add(key));
  }

  restore(state: AgentPiPromptDisclosureState | undefined): void {
    this.reset();
    if (!state || state.version !== AgentPiPromptDisclosureStateVersion) return;
    state.skillKeys.forEach((key) => this.skillKeys.add(key));
    state.promptTemplateKeys.forEach((key) => this.promptTemplateKeys.add(key));
  }

  state(): AgentPiPromptDisclosureState {
    return {
      version: AgentPiPromptDisclosureStateVersion,
      skillKeys: [...this.skillKeys].sort(),
      promptTemplateKeys: [...this.promptTemplateKeys].sort(),
    };
  }

  reset(): void {
    this.skillKeys.clear();
    this.promptTemplateKeys.clear();
  }
}

/** Reads the latest hidden disclosure checkpoint on the active Pi branch. */
export function readAgentPiPromptDisclosureState(entries: readonly SessionEntry[]): AgentPiPromptDisclosureReadResult {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom") continue;
    if (entry.customType === AgentPiSessionCustomEntryTypes.ForkBoundary) {
      return { state: emptyAgentPiPromptDisclosureState() };
    }
    if (entry.customType !== AgentPiSessionCustomEntryTypes.PromptDisclosure) continue;
    const data = readAgentUnknownRecord(entry.data);
    if (!data) return { state: emptyAgentPiPromptDisclosureState(), invalidEntryId: entry.id };
    const version = data.version;
    const skillKeys = readStringArray(data.skillKeys);
    const promptTemplateKeys = readStringArray(data.promptTemplateKeys);
    if (
      version !== AgentPiPromptDisclosureStateVersion ||
      skillKeys === undefined ||
      promptTemplateKeys === undefined
    ) {
      return { state: emptyAgentPiPromptDisclosureState(), invalidEntryId: entry.id };
    }
    return {
      state: {
        version: AgentPiPromptDisclosureStateVersion,
        skillKeys,
        promptTemplateKeys,
      },
    };
  }
  return { state: emptyAgentPiPromptDisclosureState() };
}

export function emptyAgentPiPromptDisclosureState(): AgentPiPromptDisclosureState {
  return {
    version: AgentPiPromptDisclosureStateVersion,
    skillKeys: [],
    promptTemplateKeys: [],
  };
}

export function agentPiSkillDisclosureKey(skill: Pick<Skill, "name" | "filePath" | "content">): string {
  return sha256Hex(`${skill.name}\u0000${skill.filePath}\u0000${skill.content}`);
}

export function agentPiPromptTemplateDisclosureKey(
  template: Pick<AgentPiSelectedPromptTemplateFrame, "name" | "content">,
): string {
  return sha256Hex(`${template.name}\u0000${template.content}`);
}

function disclosureDigest(key: string): string {
  return key.slice(0, 12);
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((entry) => {
    const string = readAgentString(entry)?.trim();
    return string ? [string] : [];
  });
  return values.length === value.length ? [...new Set(values)].sort() : undefined;
}
