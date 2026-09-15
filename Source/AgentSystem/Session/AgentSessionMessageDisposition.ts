export const AgentSessionMessageDispositions = {
  CreateIfMissing: "create_if_missing",
  RequireExisting: "require_existing",
} as const;

export const AgentSessionMessageDispositionValues = [
  AgentSessionMessageDispositions.CreateIfMissing,
  AgentSessionMessageDispositions.RequireExisting,
] as const;

export type AgentSessionMessageDisposition = (typeof AgentSessionMessageDispositionValues)[number];
