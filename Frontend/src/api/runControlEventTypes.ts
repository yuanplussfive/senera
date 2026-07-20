export interface RunCancellationProgressData {
  stage: "started" | "component_completed" | "component_failed" | "completed" | "failed";
  component?: "agent_loop" | "pi_session";
  durationMs?: number;
  message?: string;
}

export interface RequestInvalidData {
  message: string;
  details?: unknown;
}
