import type { ResolvedAgentServerConfig } from "../Types/AgentConfigTypes.js";

/** Selected by the process entrypoint, never by request headers or workspace configuration. */
export const AgentServerAccessProfiles = {
  Configured: "configured",
  Desktop: "desktop",
  Development: "development",
  Container: "container",
} as const;

export type AgentServerAccessProfile = (typeof AgentServerAccessProfiles)[keyof typeof AgentServerAccessProfiles];

export interface AgentServerAccessPolicy {
  readonly server: ResolvedAgentServerConfig;
  readonly authenticationRequired: boolean;
  readonly allowLoopbackHttp: boolean;
}

export function resolveAgentServerAccessPolicy(
  server: ResolvedAgentServerConfig,
  profile: AgentServerAccessProfile = AgentServerAccessProfiles.Configured,
): AgentServerAccessPolicy {
  const desktop = profile === AgentServerAccessProfiles.Desktop;
  return {
    server: desktop ? { ...server, Host: "127.0.0.1" } : server,
    authenticationRequired: !desktop && resolveAuthenticationRequired(server),
    allowLoopbackHttp: profile !== AgentServerAccessProfiles.Configured,
  };
}

export function resolveAuthenticationRequired(server: ResolvedAgentServerConfig): boolean {
  if (server.AccessControl.Mode === "required") return true;
  if (server.AccessControl.Mode === "disabled") return false;
  return !isLoopbackHost(server.Host);
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
