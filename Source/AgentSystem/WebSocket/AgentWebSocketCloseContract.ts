export const AgentWebSocketCloseCodes = {
  AuthenticationRequired: 4401,
  AccessForbidden: 4403,
  WorkspaceNotFound: 4404,
} as const;

export type AgentWebSocketCloseCode = (typeof AgentWebSocketCloseCodes)[keyof typeof AgentWebSocketCloseCodes];

export const AgentWebSocketCloseReasons = {
  AuthenticationRequired: "authentication_required",
  AccessForbidden: "access_forbidden",
  WorkspaceNotFound: "workspace_not_found",
} as const;
