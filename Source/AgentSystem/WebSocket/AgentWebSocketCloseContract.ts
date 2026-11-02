export const AgentWebSocketCloseCodes = {
  HeartbeatTimeout: 4000,
  AuthenticationRequired: 4401,
  AccessForbidden: 4403,
  WorkspaceNotFound: 4404,
} as const;

export type AgentWebSocketCloseCode = (typeof AgentWebSocketCloseCodes)[keyof typeof AgentWebSocketCloseCodes];

export const AgentWebSocketCloseReasons = {
  HeartbeatTimeout: "heartbeat_timeout",
  AuthenticationRequired: "authentication_required",
  AccessForbidden: "access_forbidden",
  WorkspaceNotFound: "workspace_not_found",
} as const;
