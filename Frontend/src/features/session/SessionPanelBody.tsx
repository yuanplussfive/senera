import { Search, X } from "lucide-react";
import { MetaLabel, ScrollArea } from "../../shared/ui";
import { MotionList, MotionListItem } from "../../shared/motion";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { SessionRecord } from "../../store/sessionStore";
import { EmptyState, SessionRow } from "./SessionRows";
import { formatSessionSubtitle } from "./sessionPresentation";

interface SessionPanelBodyProps {
  sessions: readonly SessionRecord[];
  totalSessionCount: number;
  query: string;
  onQueryChange: (query: string) => void;
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
  totalSessionCount,
  query,
  onQueryChange,
  activeSessionId,
  historyLoadingIds,
  showInlineRowActions,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: SessionPanelBodyProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
      <label className="group relative mb-2 block shrink-0">
        <span className="sr-only">{frontendMessage("session.searchPlaceholder")}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400 group-focus-within:text-terra-600" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={frontendMessage("session.searchPlaceholder")}
          className="h-8 w-full rounded-md border border-ink-200/80 bg-[var(--theme-elevated-bg)] pl-8 pr-8 text-[12px] text-ink-800 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-400 focus:border-terra-300 focus:ring-2 focus:ring-terra-100/70"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-400 transition-colors duration-150 hover:bg-ink-900/[0.05] hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
            aria-label={frontendMessage("session.searchClear")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>

      <ScrollArea className="min-h-0 flex-1">
        <div className="pb-2">
          {totalSessionCount === 0 ? (
            <EmptyState onNewSession={onNewSession} />
          ) : sessions.length === 0 ? (
            <div className="px-3 py-10 text-center text-[12px] leading-5 text-ink-500">
              {frontendMessage("session.searchEmpty")}
            </div>
          ) : (
            <>
              <div className="px-2 pb-1.5 pt-1">
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
    </div>
  );
}
