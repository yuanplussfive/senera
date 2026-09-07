import type { AgentServerPrincipal } from "./AgentAdminSessionStore.js";

export const AgentAuthenticationHttpRoutes = {
  Session: "/api/auth/session",
  Login: "/api/auth/login",
  Logout: "/api/auth/logout",
} as const;

export const AgentAuthenticationSessionStates = {
  Disabled: "disabled",
  Anonymous: "anonymous",
  Authenticated: "authenticated",
} as const;

export type AgentAuthenticationSessionState =
  (typeof AgentAuthenticationSessionStates)[keyof typeof AgentAuthenticationSessionStates];

export type AgentAuthenticationSession =
  | { readonly state: typeof AgentAuthenticationSessionStates.Disabled }
  | { readonly state: typeof AgentAuthenticationSessionStates.Anonymous }
  | {
      readonly state: typeof AgentAuthenticationSessionStates.Authenticated;
      readonly account: AgentServerPrincipal;
      readonly csrfToken: string;
      readonly expiresAt: string;
    };

export interface AgentAuthenticationSessionResponse {
  readonly ok: true;
  readonly session: AgentAuthenticationSession;
}
