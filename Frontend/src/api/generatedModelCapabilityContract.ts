// Generated from AgentModelCapabilityContract.ts. Do not edit.
/** Shared capability matching for model consumers. Generated into the frontend. */
export const AgentModelCapabilityKeys = [
  "Chat",
  "Vision",
  "ImageOutput",
  "Reasoning",
  "DeveloperRole",
  "StreamingUsage",
  "ToolCalling",
] as const;

export type AgentModelCapabilityKey = (typeof AgentModelCapabilityKeys)[number];
export const AgentImageGenerationApis = ["openrouter-images", "openai-images"] as const;
export interface AgentImageGenerationConfiguration {
  Api: (typeof AgentImageGenerationApis)[number];
  Editing?: boolean;
  Mask?: boolean;
}
export type AgentModelCapabilityFlags = Partial<Record<AgentModelCapabilityKey, boolean>>;
export type AgentModelInvocationCapabilities = AgentModelCapabilityFlags & { readonly Stream?: boolean };
export type AgentModelRequirementKey = keyof AgentModelInvocationCapabilities;
export type AgentModelRequirements = Readonly<Partial<Record<AgentModelRequirementKey, true>>>;

/** Product configuration defaults, shared with the editor; these are not catalog inference. */
export const AgentModelInvocationDefaults = {
  Capabilities: {
    Chat: true,
    Vision: false,
    ImageOutput: false,
    Reasoning: false,
    DeveloperRole: false,
    StreamingUsage: true,
    ToolCalling: true,
  } satisfies Required<AgentModelCapabilityFlags>,
  ToolPlanningMode: "native",
  Stream: true,
} as const;

export const AgentModelRequestRequirements = {
  Text: { Chat: true },
  Vision: { Chat: true, Vision: true },
  NativeTools: { Chat: true, ToolCalling: true },
  ImageOutput: { ImageOutput: true },
} as const satisfies Record<string, AgentModelRequirements>;

/** Planning policy is a consumer requirement, never a claim about model capabilities. */
export const AgentModelPlanningRequirements = {
  native: { ...AgentModelRequestRequirements.NativeTools, Stream: true },
  baml: AgentModelRequestRequirements.Text,
} as const satisfies Record<string, AgentModelRequirements>;

export function readAgentModelRequirementIssues(
  capabilities: AgentModelInvocationCapabilities,
  requirements: AgentModelRequirements,
): AgentModelRequirementKey[] {
  return (Object.keys(requirements) as AgentModelRequirementKey[]).filter((key) => capabilities[key] !== true);
}

export function agentModelMeetsRequirements(
  capabilities: AgentModelInvocationCapabilities,
  requirements: AgentModelRequirements,
): boolean {
  return readAgentModelRequirementIssues(capabilities, requirements).length === 0;
}
