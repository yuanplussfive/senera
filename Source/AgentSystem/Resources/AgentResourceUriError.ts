export class AgentResourceUriError extends Error {
  constructor(
    readonly value: string,
    readonly code: "invalid_resource_id",
  ) {
    super(`Invalid Senera resource identifier: ${value}.`);
  }
}
