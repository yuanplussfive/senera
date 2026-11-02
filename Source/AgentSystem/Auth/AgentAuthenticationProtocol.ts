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

export const AgentAuthenticationMethods = {
  Local: "local",
  Account: "account",
  Device: "device",
} as const;

export type AgentAuthenticationMethod = (typeof AgentAuthenticationMethods)[keyof typeof AgentAuthenticationMethods];

export type AgentAuthenticationSessionState =
  (typeof AgentAuthenticationSessionStates)[keyof typeof AgentAuthenticationSessionStates];

export interface AgentServerPrincipal {
  readonly id: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly role: "owner";
}

export interface AgentAdminSession {
  readonly id: string;
  readonly principal: AgentServerPrincipal;
  readonly authenticationMethod: AgentAuthenticationMethod;
  readonly csrfToken: string;
  readonly expiresAt: number;
  readonly idleExpiresAt: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly deviceName?: string;
}

export type AgentAuthenticationSession =
  | { readonly state: typeof AgentAuthenticationSessionStates.Disabled }
  | { readonly state: typeof AgentAuthenticationSessionStates.Anonymous }
  | {
      readonly state: typeof AgentAuthenticationSessionStates.Authenticated;
      readonly method: AgentAuthenticationMethod;
      readonly account: AgentServerPrincipal;
      readonly csrfToken: string;
      readonly expiresAt: string;
    };

export interface AgentAuthenticationSessionResponse {
  readonly ok: true;
  readonly session: AgentAuthenticationSession;
}

export type AgentAuthenticatedSession = Extract<
  AgentAuthenticationSession,
  { readonly state: typeof AgentAuthenticationSessionStates.Authenticated }
>;

export function projectAgentAuthenticationSession(session: AgentAdminSession): AgentAuthenticatedSession {
  return {
    state: AgentAuthenticationSessionStates.Authenticated,
    method: session.authenticationMethod,
    account: session.principal,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}
