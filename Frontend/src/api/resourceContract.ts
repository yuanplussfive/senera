// Generated from the backend resource transport contract.
// Run `npm run generate.resource-contract` after editing the backend contract.

export const SeneraResourceUriContract = {
  Protocol: "senera:",
  Authority: "resource",
  ResourceIdPattern: "[A-Za-z0-9][A-Za-z0-9._~-]{0,255}",
} as const;

export const SeneraResourceHttpRoutes = {
  Collection: "/api/resources",
  WorkspaceContent: "/api/resources/content",
} as const;
