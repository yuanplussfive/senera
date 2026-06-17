import { formatDuration } from "../../lib/util";
import type { SessionRecord } from "../../store/sessionStore";

export function formatSessionSubtitle(
  session: SessionRecord,
  isHistoryLoading: boolean,
): string {
  const lastRun = session.runs[session.runs.length - 1];
  if (lastRun?.status === "running") return "正在思考…";
  if (lastRun?.status === "failed") return "上次运行失败";
  if (session.messageCount > 0) {
    if (lastRun) return `${session.messageCount} 条消息 · ${formatDuration(lastRun.startedAt, lastRun.endedAt)}`;
    if (isHistoryLoading) return `${session.messageCount} 条消息 · 同步中`;
    return `${session.messageCount} 条消息`;
  }
  return isHistoryLoading ? "同步中" : "尚无消息";
}
