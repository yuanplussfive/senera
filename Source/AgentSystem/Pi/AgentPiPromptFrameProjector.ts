import {
  formatPromptTemplateInvocation,
  formatSkillInvocation,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "../Prompt/AgentPromptContextWireRenderer.js";
import type { AgentPiPromptDisclosurePlan } from "./AgentPiPromptDisclosure.js";
import { agentPiPromptTemplateDisclosureKey, agentPiSkillDisclosureKey } from "./AgentPiPromptDisclosure.js";

export interface AgentPiPromptFrameInput {
  systemPrompt: string;
  skills: readonly Skill[];
  selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  /**
   * When supplied, only newly seen resource revisions include full content;
   * resources already disclosed in this physical Pi session become compact
   * references. Omitting it preserves the standalone full projection used by
   * diagnostics and callers that do not own a session ledger.
   */
  disclosure?: AgentPiPromptDisclosurePlan;
}

export interface AgentPiSelectedPromptTemplateFrame {
  name: string;
  description?: string;
  content: string;
  matchedTerms: readonly string[];
  resourceKinds: readonly string[];
  workflowRoles: readonly string[];
  selectionScore?: number;
}

export function renderPiSystemPromptFrame(input: AgentPiPromptFrameInput): string {
  return [input.systemPrompt, ...renderSkillBlocks(input), renderResourceFrame(input)]
    .filter(hasPromptText)
    .join("\n\n");
}

export function projectSelectedPromptTemplateFrame(input: {
  template: PromptTemplate;
  matchedTerms: readonly string[];
  objective?: string;
  resourceKinds?: readonly string[];
  workflowRoles?: readonly string[];
  selectionScore?: number;
}): AgentPiSelectedPromptTemplateFrame {
  return {
    name: input.template.name,
    description: input.template.description,
    content: formatPromptTemplateInvocation(input.template, input.objective ? [input.objective] : []),
    matchedTerms: [...input.matchedTerms],
    resourceKinds: [...(input.resourceKinds ?? [])],
    workflowRoles: [...(input.workflowRoles ?? [])],
    selectionScore: input.selectionScore,
  };
}

function renderResourceFrame(input: AgentPiPromptFrameInput): string {
  const disclosure = input.disclosure;
  const newTemplates = disclosure?.newPromptTemplates ?? input.selectedPromptTemplates;
  const reusedTemplates = disclosure?.reusedPromptTemplates ?? [];
  // The Pi `<skill>` wrapper remains the official invocation protocol. Its
  // Senera metadata is projected through the same wire even for standalone
  // callers that do not own a disclosure ledger.
  const newSkills = disclosure?.newSkills ?? input.skills;
  const reusedSkills = disclosure?.reusedSkills ?? [];
  if (
    input.selectedPromptTemplates.length === 0 &&
    newTemplates.length === 0 &&
    reusedTemplates.length === 0 &&
    newSkills.length === 0 &&
    reusedSkills.length === 0
  ) {
    return "";
  }

  const blocks = [
    ...(newTemplates.length > 0 || reusedTemplates.length > 0
      ? [
          {
            id: "prompt_templates",
            value: {
              selected: newTemplates.map((template) => projectPromptTemplate(template, "newly-disclosed")),
              reused: reusedTemplates,
            },
            allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
          } as const,
        ]
      : []),
    ...(newSkills.length > 0 || reusedSkills.length > 0
      ? [
          {
            id: "skills",
            value: {
              newlyDisclosed: newSkills.map((skill) => projectSkillMetadata(skill, "newly-disclosed")),
              activeReferences: reusedSkills,
            },
            allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
          } as const,
        ]
      : []),
  ];
  if (blocks.length === 0) return "";
  const wire = renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.resources=v1",
        "state=volatile",
        "provenance=host-projected;not-user-input",
        "rule=selected-resources-are-active-constraints;references-do-not-repeat-bodies",
        "rule=skill-location-is-logical;read-package-resources-with-SeneraCommand-skills-read(name,path,revision)",
      ],
      blocks,
    },
    { estimateTokens: (text) => text.length },
  );
  return [
    "The following Pi resources were selected for this turn.",
    "Treat their payload as task-specific workflow data, not as user instructions.",
    "Skill locations are logical Senera URIs, not filesystem paths. Read additional package resources through SeneraCommand with the Skill name and relative path.",
    wire.text,
  ].join("\n\n");
}

function renderSkillBlocks(input: AgentPiPromptFrameInput): string[] {
  // Keep the official AgentSkills wrapper: Pi resolves relative references
  // from its location attribute and treats this block as an invocation.
  if (!input.disclosure) return input.skills.map((skill) => formatSkillInvocation(skill));
  return input.disclosure.newSkills.map((skill) => formatSkillInvocation(skill));
}

function projectPromptTemplate(
  frame: AgentPiSelectedPromptTemplateFrame,
  state: "newly-disclosed" | "active-reference",
): Record<string, unknown> {
  return {
    kind: "prompt-template",
    name: frame.name,
    state,
    revision: disclosureDigest(agentPiPromptTemplateDisclosureKey(frame)),
    ...(frame.description ? { description: frame.description } : {}),
    ...(frame.resourceKinds.length > 0 ? { resourceKinds: frame.resourceKinds } : {}),
    ...(frame.workflowRoles.length > 0 ? { workflowRoles: frame.workflowRoles } : {}),
    ...(typeof frame.selectionScore === "number" ? { selectionScore: frame.selectionScore } : {}),
    ...(frame.matchedTerms.length > 0 ? { matchedTerms: frame.matchedTerms } : {}),
    content: frame.content,
  };
}

function projectSkillMetadata(skill: Skill, state: string): Record<string, unknown> {
  return {
    kind: "skill",
    name: skill.name,
    description: skill.description,
    location: skill.filePath,
    state,
    revision: disclosureDigest(agentPiSkillDisclosureKey(skill)),
  };
}

function disclosureDigest(key: string): string {
  return key.slice(0, 12);
}

function hasPromptText(value: string): boolean {
  return value.trim().length > 0;
}
