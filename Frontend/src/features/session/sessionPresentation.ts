import { formatDuration } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { SessionRecord } from "../../store/sessionStore";

export function formatSessionSubtitle(session: SessionRecord, isHistoryLoading: boolean): string {
  const lastRun = session.runs[session.runs.length - 1];
  if (lastRun?.status === "running") return frontendMessage("session.subtitle.thinking");
  if (lastRun?.status === "failed") return frontendMessage("session.subtitle.lastRunFailed");
  if (session.messageCount > 0) {
    if (lastRun)
      return frontendMessage("session.subtitle.messagesWithDuration", {
        count: session.messageCount,
        duration: formatDuration(lastRun.startedAt, lastRun.endedAt),
      });
    if (isHistoryLoading) return frontendMessage("session.subtitle.messagesSyncing", { count: session.messageCount });
    return frontendMessage("session.subtitle.messages", { count: session.messageCount });
  }
  return frontendMessage(isHistoryLoading ? "session.subtitle.syncing" : "session.subtitle.empty");
}
