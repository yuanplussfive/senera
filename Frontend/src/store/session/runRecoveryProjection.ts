import type { ChatMessage, SessionRecord } from "./types";

/** Recovery is confirmed only by the server's durable run.started lineage. */
export function readSupersededFailureIds(session: Pick<SessionRecord, "runs">): Set<string> {
  return new Set(session.runs.flatMap((run) => (run.recovery ? [run.recovery.sourceRequestId] : [])));
}

export function isSupersededFailure(message: ChatMessage, superseded: ReadonlySet<string>): boolean {
  return (
    message.role === "system" && message.kind === "Error" && !!message.requestId && superseded.has(message.requestId)
  );
}

export function rejectRunRecovery(session: SessionRecord, requestId: string | undefined, message: string): boolean {
  if (!requestId) return false;
  const source = session.runs.find((run) => run.recoveryAttempt?.requestId === requestId);
  if (!source?.recoveryAttempt || source.recoveryAttempt.status !== "pending") return false;
  source.recoveryAttempt.status = "rejected";
  source.recoveryAttempt.message = message;
  source.revision += 1;
  return true;
}
