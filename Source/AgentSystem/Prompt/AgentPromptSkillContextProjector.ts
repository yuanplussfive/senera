import type { AgentActivatedSkill } from "../AgentSkillActivation.js";
import type {
  AgentPromptSkillCatalogContext,
  AgentPromptSkillContext,
} from "./AgentPromptContextTypes.js";
import type { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";

export class AgentPromptSkillContextProjector {
  constructor(
    private readonly documentationReader: AgentPromptDocumentationReader,
  ) {}

  projectActiveSkills(activeSkills: readonly AgentActivatedSkill[]): AgentPromptSkillContext[] {
    return activeSkills.map((skill) => ({
      ...this.toCatalogContext(skill),
      documentationXml: this.documentationReader.renderMarkdownFile(skill.descriptionFile),
      workflowXml: skill.workflowFile
        ? this.documentationReader.renderMarkdownFile(skill.workflowFile)
        : "",
      matchedTerms: [...new Set(skill.matchedTerms)],
      matchedFields: skill.matchedFields.map((entry) => ({
        term: entry.term,
        fields: [...entry.fields],
      })),
      score: Number(skill.score.toFixed(6)),
    }));
  }

  private toCatalogContext(skill: Pick<
    AgentActivatedSkill,
    "name" | "title" | "summary" | "useCases" | "avoid" | "recommendedTools"
    | "recommendedAgents" | "recommendedWorkflows"
  >): AgentPromptSkillCatalogContext {
    return {
      name: skill.name,
      title: skill.title,
      summary: skill.summary,
      useCases: skill.useCases,
      avoid: skill.avoid,
      recommendedTools: skill.recommendedTools,
      recommendedAgents: skill.recommendedAgents,
      recommendedWorkflows: skill.recommendedWorkflows,
    };
  }
}
