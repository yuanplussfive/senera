export const AgentModelEndpointKinds = [
  "Responses",
  "ChatCompletions",
  "ClaudeMessages",
  "GoogleGenerateContent",
] as const;

export type AgentModelEndpointKind = (typeof AgentModelEndpointKinds)[number];
