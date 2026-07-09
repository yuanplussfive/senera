import type { ToolSearchManifest } from "./PluginSearchManifestTypes.js";

export interface SkillManifest {
  Name: string;
  Title?: string;
  DescriptionFile: string;
  RecommendedTools?: string[];
  EvidenceRequirements?: SkillEvidenceRequirementManifest[];
  Search?: ToolSearchManifest;
}

export interface SkillEvidenceRequirementManifest {
  Need: string;
  Accepts: string[];
  MinimumQuality?: string[];
  Minimum?: number;
  Purpose?: string;
}
