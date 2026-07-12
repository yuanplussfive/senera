import { MetaLabel, ScrollArea } from "../../shared/ui";
import { MotionList, MotionListItem } from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { SessionRecord } from "../../store/sessionStore";
import { EmptyState, SessionRow } from "./SessionRows";
import { formatSessionSubtitle } from "./sessionPresentation";

interface SessionPanelBodyProps {
  sessions: readonly SessionRecord[];
  activeSessionId: string | null;
  historyLoadingIds: Readonly<Record<string, boolean>>;
  showInlineRowActions: boolean;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: SessionRecord) => void;
  onDeleteSession: (session: SessionRecord) => void;
}

export function SessionPanelBody({
  sessions,
  activeSessionId,
  historyLoadingIds,
  showInlineRowActions,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: SessionPanelBodyProps): JSX.Element {
  return (
    <ScrollArea className="flex-1">
      <div className="px-2 pb-3">
        {sessions.length === 0 ? (
          <EmptyState onNewSession={onNewSession} />
        ) : (
          <>
            <div className="mt-1 px-2 pb-1.5">
              <MetaLabel as="div" size="sm">
                {frontendMessage("session.recentCount", { count: sessions.length })}
              </MetaLabel>
            </div>
            <MotionList>
              {sessions.map((session, index) => {
                const isActive = session.sessionId === activeSessionId;
                const lastRun = session.runs[session.runs.length - 1];
                const isRunning = lastRun?.status === "running";
                const hasFailed = lastRun?.status === "failed";
                const isHistoryLoading = !!historyLoadingIds[session.sessionId];
                const subtitle = formatSessionSubtitle(session, isHistoryLoading);

                return (
                  <MotionListItem key={session.sessionId} index={index} itemCount={sessions.length} layout="position">
                    <SessionRow
                      active={isActive}
                      sessionId={session.sessionId}
                      title={session.title}
                      subtitle={subtitle}
                      accent={isRunning ? "running" : hasFailed ? "failed" : "idle"}
                      onClick={() => onSelectSession(session.sessionId)}
                      showInlineActions={showInlineRowActions}
                      onRename={() => onRenameSession(session)}
                      onClose={() => onDeleteSession(session)}
                    />
                  </MotionListItem>
                );
              })}
            </MotionList>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
