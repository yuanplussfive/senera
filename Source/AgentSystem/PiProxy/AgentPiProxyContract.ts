import { resolveServerConfig } from "../AgentDefaults.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export const AgentPiProxyProtocol = {
  providerId: "senera-pi-proxy",
  modelApi: "openai-completions",
  apiKey: "senera-local",
  basePath: "/v1",
  routes: {
    models: "/v1/models",
    chatCompletions: "/v1/chat/completions",
  },
} as const;

export type AgentPiProxyModelApi = typeof AgentPiProxyProtocol.modelApi;

const ClientHostByBindHost = new Map([
  ["0.0.0.0", "127.0.0.1"],
  ["::", "[::1]"],
  ["[::]", "[::1]"],
]);

export function resolveAgentPiProxyBaseUrl(config: AgentSystemConfig): string {
  const server = resolveServerConfig(config);
  return `http://${resolveClientHost(server.Host)}:${server.Port}${AgentPiProxyProtocol.basePath}`;
}

function resolveClientHost(bindHost: string): string {
  return ClientHostByBindHost.get(bindHost) ?? bindHost;
}
