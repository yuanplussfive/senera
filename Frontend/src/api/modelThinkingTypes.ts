export type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelThinkingProfile {
  id: string;
  label: string;
  level: ModelThinkingLevel;
}

export interface ModelThinkingProfileConfig {
  Id: string;
  Label: string;
  Level: ModelThinkingLevel;
}
