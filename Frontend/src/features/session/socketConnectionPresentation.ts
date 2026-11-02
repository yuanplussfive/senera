import type { SocketStatus } from "../../api/useAgentSocket";

export type SocketConnectionTone = "pending" | "danger" | "success";

export interface SocketConnectionPresentation {
  readonly tone: SocketConnectionTone;
  readonly messageKey: "connection.connecting" | "connection.closed" | "connection.error" | "connection.open";
  /** A degraded state the user can shorten by retrying now. */
  readonly retryable: boolean;
  /** Transient states only show for a moment after they are reached. */
  readonly transient: boolean;
}

/**
 * Only a degraded or just-recovered socket is worth a persistent surface: an
 * open socket stays silent so the footer keeps its single account row.
 */
export function readSocketConnectionPresentation(status: SocketStatus): SocketConnectionPresentation | null {
  switch (status) {
    case "connecting":
      return { tone: "pending", messageKey: "connection.connecting", retryable: true, transient: false };
    case "closed":
      return { tone: "danger", messageKey: "connection.closed", retryable: true, transient: false };
    case "error":
      return { tone: "danger", messageKey: "connection.error", retryable: true, transient: false };
    case "open":
      return { tone: "success", messageKey: "connection.open", retryable: false, transient: true };
    default:
      return null;
  }
}

export const SocketConnectionToneStyles: Readonly<Record<SocketConnectionTone, { dot: string; text: string }>> = {
  pending: { dot: "bg-accent-content", text: "text-content-secondary" },
  danger: { dot: "bg-brick-500", text: "text-brick-600" },
  success: { dot: "bg-moss-500", text: "text-moss-600" },
};
