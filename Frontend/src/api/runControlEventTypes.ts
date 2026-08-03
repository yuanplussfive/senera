import type { BackendLocalizedMessage } from "../i18n/backendMessage";

export interface RunCancellationProgressData {
  stage: "started" | "component_completed" | "component_failed" | "completed" | "failed";
  component?: "agent_loop" | "pi_session";
  durationMs?: number;
  message?: string;
  localizedMessage?: BackendLocalizedMessage;
}

/** 与后端 AgentRequestInvalidCode 保持一致（Source/AgentSystem/Events/AgentRunEventTypes.ts） */
export type RequestInvalidCode =
  | "approval_not_pending"
  | "interaction_input_resolve_failed"
  | "request_parse_failed"
  | "tool_settings_request_failed"
  | "session_fork_boundary_missing"
  | "session_fork_target_exists"
  | "session_pi_fork_failed"
  | "session_pi_unavailable";

export interface RequestInvalidData {
  code?: RequestInvalidCode;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
}
