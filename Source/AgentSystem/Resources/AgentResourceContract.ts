/**
 * Canonical resource identifiers and HTTP routes shared by every resource
 * producer and consumer. Keep this contract transport-oriented so it can be
 * generated for the frontend without importing server-only modules.
 */
export const AgentResourceUriContract = {
  Protocol: "senera:",
  Authority: "resource",
  ResourceIdPattern: "[A-Za-z0-9][A-Za-z0-9._~-]{0,255}",
} as const;

export const AgentResourceHttpRoutes = {
  Collection: "/api/resources",
  WorkspaceContent: "/api/resources/content",
} as const;
