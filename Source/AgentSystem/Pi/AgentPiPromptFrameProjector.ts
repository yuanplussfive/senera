import { encodeXML } from "entities";
import {
  formatPromptTemplateInvocation,
  formatSkillsForSystemPrompt,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";

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

export function renderPiHarnessSystemPrompt(input: AgentPiPromptFrameInput): string {
  return [input.systemPrompt, formatSkillsForSystemPrompt([...input.skills]), renderSelectedPromptTemplateFrame(input)]
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

function renderSelectedPromptTemplateFrame(input: AgentPiPromptFrameInput): string {
  if (input.selectedPromptTemplates.length === 0) {
    return "";
  }

  return [
    "The following Pi execution resources were selected automatically for this turn.",
    "Treat them as task-specific workflow constraints for the Pi harness. They are not examples and should not be copied into the final answer unless directly useful.",
    "",
    "<pi_execution_resources>",
    ...input.selectedPromptTemplates.map(renderSelectedPromptTemplate),
    "</pi_execution_resources>",
  ].join("\n");
}

function renderSelectedPromptTemplate(frame: AgentPiSelectedPromptTemplateFrame): string {
  return [
    "  <frame>",
    `    <name>${encodeXML(frame.name)}</name>`,
    frame.description ? `    <description>${encodeXML(frame.description)}</description>` : "",
    frame.resourceKinds.length > 0
      ? `    <resource_kinds>${encodeXML(frame.resourceKinds.join(", "))}</resource_kinds>`
      : "",
    frame.workflowRoles.length > 0
      ? `    <workflow_roles>${encodeXML(frame.workflowRoles.join(", "))}</workflow_roles>`
      : "",
    typeof frame.selectionScore === "number"
      ? `    <selection_score>${encodeXML(frame.selectionScore.toFixed(3))}</selection_score>`
      : "",
    frame.matchedTerms.length > 0
      ? `    <matched_terms>${encodeXML(frame.matchedTerms.join(", "))}</matched_terms>`
      : "",
    "    <content>",
    encodeXML(frame.content),
    "    </content>",
    "  </frame>",
  ]
    .filter(hasPromptText)
    .join("\n");
}

function hasPromptText(value: string): boolean {
  return value.trim().length > 0;
}
