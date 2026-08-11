export const AgentModelEndpointKinds = [
  "Responses",
  "ChatCompletions",
  "ClaudeMessages",
  "GoogleGenerateContent",
] as const;

export type AgentModelEndpointKind = (typeof AgentModelEndpointKinds)[number];

export const AgentModelToolPlanningModes = ["native", "baml"] as const;

export type AgentModelToolPlanningMode = (typeof AgentModelToolPlanningModes)[number];

/** Pi API adapters are selected from the declared wire protocol, never from model names. */
export const AgentNativeToolApiByEndpoint = {
  Responses: "openai-responses",
  ChatCompletions: "openai-completions",
  ClaudeMessages: "anthropic-messages",
  GoogleGenerateContent: "google-generative-ai",
} as const;

export type AgentNativeToolApi = (typeof AgentNativeToolApiByEndpoint)[AgentModelEndpointKind];

const AgentNativeToolSdkOwnedBasePath = {
  Responses: [],
  ChatCompletions: [],
  ClaudeMessages: ["v1"],
  GoogleGenerateContent: [],
} as const satisfies Record<AgentModelEndpointKind, readonly string[]>;

export interface AgentNativeToolRoute {
  readonly api: AgentNativeToolApi;
  readonly baseUrl: string;
}

/**
 * Adapts Senera's configured API root to the URL ownership contract of the
 * selected Pi SDK. Path overlap is removed by exact URL segments only.
 */
export function resolveAgentNativeToolRoute(
  endpoint: AgentModelEndpointKind,
  configuredBaseUrl: string,
): AgentNativeToolRoute {
  return {
    api: AgentNativeToolApiByEndpoint[endpoint],
    baseUrl: removeSdkOwnedBasePath(configuredBaseUrl, AgentNativeToolSdkOwnedBasePath[endpoint]),
  };
}

export function supportsNativeToolCalling(endpoint: AgentModelEndpointKind): boolean {
  return Object.hasOwn(AgentNativeToolApiByEndpoint, endpoint);
}

function removeSdkOwnedBasePath(configuredBaseUrl: string, sdkOwnedPath: readonly string[]): string {
  if (sdkOwnedPath.length === 0) return configuredBaseUrl;
  const url = new URL(configuredBaseUrl);
  const configuredPath = url.pathname.split("/").filter(Boolean);
  const overlapStart = configuredPath.length - sdkOwnedPath.length;
  if (overlapStart < 0 || !sdkOwnedPath.every((segment, index) => configuredPath[overlapStart + index] === segment)) {
    return configuredBaseUrl;
  }
  const retainedPath = configuredPath.slice(0, overlapStart);
  url.pathname = retainedPath.length > 0 ? `/${retainedPath.join("/")}` : "/";
  return url.toString();
}
