import type { ToolSearchManifest } from "../Types/AgentToolContractTypes.js";

export interface SkillEvidenceRequirementManifest {
  Need: string;
  Accepts: string[];
  MinimumQuality?: string[];
  Minimum?: number;
  Purpose?: string;
}

export type AgentSkillSource =
  | {
      kind: "standalone";
      id: string;
      displayName: string;
      priority?: number;
    }
  | {
      kind: "system";
      id: string;
      displayName: string;
      priority?: number;
    };

export interface RegisteredSkill {
  source: AgentSkillSource;
  name: string;
  title?: string;
  description: string;
  descriptionFile: string;
  /** Content revision used to scope learned routing evidence. */
  revision?: string;
  recommendedTools: string[];
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  search?: ToolSearchManifest;
}
