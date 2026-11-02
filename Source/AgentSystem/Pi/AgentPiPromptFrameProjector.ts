import type { AgentPiActivatedSkill as Skill } from "./AgentPiSkillCatalog.js";
import type { AgentPiPromptTemplate } from "./AgentPiPromptTemplateProjector.js";
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
  template: AgentPiPromptTemplate;
  matchedTerms: readonly string[];
  objective?: string;
  resourceKinds?: readonly string[];
  workflowRoles?: readonly string[];
  selectionScore?: number;
}): AgentPiSelectedPromptTemplateFrame {
  return {
    name: input.template.name,
    description: input.template.description,
    content: renderPromptTemplateArguments(input.template.content, input.objective ? [input.objective] : []),
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
              load: "on-demand",
              active: [...new Set(input.skills.map((skill) => skill.name))],
            },
            allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
          } as const,
        ]
      : []),
  ];
  if (blocks.length === 0) return "";
  const wire = renderAgentPromptWireBlocks(
    {
      preamble: ["senera.resources=v1"],
      blocks,
    },
    { estimateTokens: (text) => text.length },
  );
  return wire.text;
}

function projectPromptTemplate(frame: AgentPiSelectedPromptTemplateFrame): Record<string, unknown> {
  return {
    name: frame.name,
    ...(frame.description ? { description: frame.description } : {}),
    ...(frame.resourceKinds.length > 0 ? { resourceKinds: frame.resourceKinds } : {}),
    ...(frame.workflowRoles.length > 0 ? { workflowRoles: frame.workflowRoles } : {}),
    content: frame.content,
  };
}

function hasPromptText(value: string): boolean {
  return value.trim().length > 0;
}

/** Expand host-selected template arguments once; inserted user text is never reinterpreted. */
function renderPromptTemplateArguments(content: string, args: readonly string[]): string {
  return content.replace(
    /\$(?:(\d+)|\{@:(\d+)(?::(\d+))?\}|ARGUMENTS|@)/g,
    (_match, position: string | undefined, start: string | undefined, length: string | undefined) => {
      if (position !== undefined) return args[Number(position) - 1] ?? "";
      if (start === undefined) return args.join(" ");
      const offset = Math.max(0, Number(start) - 1);
      return args.slice(offset, length === undefined ? undefined : offset + Number(length)).join(" ");
    },
  );
}
