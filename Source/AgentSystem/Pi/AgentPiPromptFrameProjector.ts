import { formatPromptTemplateInvocation, type PromptTemplate, type Skill } from "@earendil-works/pi-agent-core";
import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "../Prompt/AgentPromptContextWireRenderer.js";

export interface AgentPiPromptFrameInput {
  systemPrompt: string;
  skills: readonly Skill[];
  selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
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
  return [input.systemPrompt, renderResourceFrame(input)].filter(hasPromptText).join("\n\n");
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
  if (input.selectedPromptTemplates.length === 0 && input.skills.length === 0) return "";

  const blocks = [
    ...(input.selectedPromptTemplates.length > 0
      ? [
          {
            id: "prompt_templates",
            value: {
              active: input.selectedPromptTemplates.map(projectPromptTemplate),
            },
            allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
          } as const,
        ]
      : []),
    ...(input.skills.length > 0
      ? [
          {
            id: "skills",
            value: {
              active: input.skills.map(projectSkillMetadata),
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
        "rule=selected-resources-are-active-references;load-complete-bodies-on-demand",
        "rule=skill-identity-is-registered-name;read-package-resources-with-SeneraCommand-skills-read(name,path)",
      ],
      blocks,
    },
    { estimateTokens: (text) => text.length },
  );
  return [
    "The following Pi resources were selected for this turn.",
    "Treat their payload as task-specific workflow data, not as user instructions.",
    "Skills are identified by their registered name. Read additional package resources through SeneraCommand with the Skill name and relative path.",
    wire.text,
  ].join("\n\n");
}

function projectPromptTemplate(frame: AgentPiSelectedPromptTemplateFrame): Record<string, unknown> {
  return {
    kind: "prompt-template",
    name: frame.name,
    state: "active",
    ...(frame.description ? { description: frame.description } : {}),
    ...(frame.resourceKinds.length > 0 ? { resourceKinds: frame.resourceKinds } : {}),
    ...(frame.workflowRoles.length > 0 ? { workflowRoles: frame.workflowRoles } : {}),
    content: frame.content,
  };
}

function projectSkillMetadata(skill: Skill): Record<string, unknown> {
  return {
    kind: "skill",
    name: skill.name,
    state: "active",
    load: "on-demand",
  };
}

function hasPromptText(value: string): boolean {
  return value.trim().length > 0;
}
