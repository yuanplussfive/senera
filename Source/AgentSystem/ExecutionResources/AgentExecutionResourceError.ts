export const AgentExecutionResourceErrorCodes = {
  InvalidOwner: "execution_resource_invalid_owner",
  NotFound: "execution_resource_not_found",
  AccessDenied: "execution_resource_access_denied",
  CapacityExceeded: "execution_resource_capacity_exceeded",
  InputTooLarge: "execution_resource_input_too_large",
  NotWritable: "execution_resource_not_writable",
  NotResizable: "execution_resource_not_resizable",
  CleanupFailed: "execution_resource_cleanup_failed",
  Closed: "execution_resource_closed",
} as const;

export type AgentExecutionResourceErrorCode =
  (typeof AgentExecutionResourceErrorCodes)[keyof typeof AgentExecutionResourceErrorCodes];

export class AgentExecutionResourceError extends Error {
  constructor(
    readonly code: AgentExecutionResourceErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentExecutionResourceError";
  }
}
