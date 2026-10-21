import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useStore,
  type ConversationProfileUpdate,
  type SessionRecord,
  type UserProfile,
} from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConfirmationDialog, RenameDialog } from "./SessionDialogs";
import { UserFooter } from "./ProfileFooter";
import { SessionHeader } from "./SessionChrome";
import { SessionPanelBody } from "./SessionPanelBody";
import type { ConfirmationIntent } from "./types";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { EventSourceChannel } from "../../api/eventTypes";
import type { SettingsSectionId } from "../settings/types";

interface Props {
  onNewSession: () => void;
  onCloseSession: (id: string) => boolean;
  onCloseSessions: (ids: readonly string[]) => {
    readonly acceptedSessionIds: readonly string[];
    readonly rejectedSessionIds: readonly string[];
  };
  onRenameSession: (id: string, title: string) => boolean;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: ConversationProfileUpdate) => void;
  onLogout?: () => Promise<void>;
  socketStatus: string;
  onSettingsIntent?: () => void;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
  httpBaseUrl?: string;
  uploadCsrfToken?: string;
  presentation?: "auto" | "panel";
  onSessionSelected?: () => void;
  onClosePanel?: () => void;
}

type RenameIntent = {
  sessionId: string;
  title: string;
};

type SessionChannelFilter = "all" | EventSourceChannel;

export function SessionList({
  onNewSession,
  onCloseSession,
  onCloseSessions,
  onRenameSession,
  userProfile,
  onUpdateUserProfile,
  onLogout,
  socketStatus,
  onSettingsIntent,
  onOpenSettings,
  httpBaseUrl,
  uploadCsrfToken,
  presentation = "auto",
  onSessionSelected,
  onClosePanel,
}: Props): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.sessionOrder);
  const active = useStore((s) => s.activeSessionId);
  const historyLoadingIds = useStore((s) => s.historyLoadingIds);
  const missingOnServerIds = useStore((s) => s.missingOnServerIds);
  const sessionCatalogSynced = useStore((s) => s.catalogSynced.sessions);
  const select = useStore((s) => s.selectSession);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const [confirmation, setConfirmation] = useState<ConfirmationIntent | null>(null);
  const [renaming, setRenaming] = useState<RenameIntent | null>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<SessionChannelFilter>("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<ReadonlySet<string>>(() => new Set());

  const sessionList = useMemo(
    () =>
      order
        .map((id) => sessions[id])
        .filter((session): session is SessionRecord => !!session && !missingOnServerIds[session.sessionId]),
    [missingOnServerIds, order, sessions],
  );

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredSessions = useMemo(
    () =>
      sessionList.filter((session) => {
        const matchesChannel = channelFilter === "all" || (session.channel?.platform ?? "console") === channelFilter;
        const matchesQuery =
          !normalizedSearchQuery || session.title.toLocaleLowerCase().includes(normalizedSearchQuery);
        return matchesChannel && matchesQuery;
      }),
    [channelFilter, normalizedSearchQuery, sessionList],
  );
  const selectedSessionCount = sessionList.filter((session) => selectedSessionIds.has(session.sessionId)).length;

  useEffect(() => {
    const availableIds = new Set(sessionList.map((session) => session.sessionId));
    setSelectedSessionIds((current) => {
      const next = new Set([...current].filter((sessionId) => availableIds.has(sessionId)));
      return next.size === current.size ? current : next;
    });
  }, [sessionList]);

  const openRename = (session: SessionRecord, returnFocus: HTMLElement | null = null): void => {
    dialogReturnFocusRef.current = returnFocus?.isConnected ? returnFocus : null;
    setRenaming({ sessionId: session.sessionId, title: session.title });
    setRenameDraft(session.title);
  };

  const submitRename = (): void => {
    if (!renaming) return;
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      toast.error(frontendMessage("session.renameEmpty"));
      return;
    }
    if (onRenameSession(renaming.sessionId, nextTitle) === false) return;
    setRenaming(null);
    toast.success(frontendMessage("session.renameSucceeded"));
  };

  const confirmDeleteSession = (session: SessionRecord, returnFocus: HTMLElement | null = null): void => {
    dialogReturnFocusRef.current = returnFocus?.isConnected ? returnFocus : null;
    setConfirmation({
      title: frontendMessage("session.deleteCurrentTitle"),
      description: frontendMessage("session.deleteCurrentDescription", { title: session.title }),
      confirmLabel: frontendMessage("session.deleteCurrentConfirm"),
      tone: "danger",
      details: [
        frontendMessage("session.deleteCurrentDetailRecords"),
        frontendMessage("session.deleteCurrentDetailRefresh"),
      ],
      onConfirm: () => {
        if (onCloseSession(session.sessionId)) {
          toast.success(frontendMessage("session.deleteRequested"));
        } else {
          toast.error(frontendMessage("session.deleteDisconnected"));
        }
      },
    });
  };

  const confirmDeleteSelected = (): void => {
    const selected = sessionList.filter((session) => selectedSessionIds.has(session.sessionId));
    if (selected.length === 0) return;

    const sessionIds = selected.map((session) => session.sessionId);
    setConfirmation({
      title: frontendMessage("session.deleteSelectedTitle"),
      description: frontendMessage("session.deleteSelectedDescription", { count: sessionIds.length }),
      confirmLabel: frontendMessage("session.deleteSelectedConfirm"),
      tone: "danger",
      details: [
        frontendMessage("session.deleteCurrentDetailRecords"),
        frontendMessage("session.deleteCurrentDetailRefresh"),
      ],
      onConfirm: () => {
        const { acceptedSessionIds, rejectedSessionIds } = onCloseSessions(sessionIds);
        setSelectedSessionIds(new Set(rejectedSessionIds));
        if (acceptedSessionIds.length > 0) {
          toast.success(frontendMessage("session.bulkDeleteRequested", { count: acceptedSessionIds.length }));
        }
        if (rejectedSessionIds.length > 0) {
          toast.error(frontendMessage("session.bulkDeletePartialFailed", { count: rejectedSessionIds.length }));
        } else {
          setSelectionMode(false);
        }
      },
    });
  };

  const compactSidebar = presentation === "auto" && sidebarCollapsed;
  const expandedPaneRef = useRef<HTMLDivElement>(null);
  const collapsedPaneRef = useRef<HTMLDivElement>(null);
  const previousCompactSidebarRef = useRef(compactSidebar);
  const lastFocusedPaneRef = useRef<"expanded" | "collapsed" | null>(null);

  useEffect(() => {
    const trackFocus = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        lastFocusedPaneRef.current = null;
        return;
      }
      if (expandedPaneRef.current?.contains(target)) lastFocusedPaneRef.current = "expanded";
      else if (collapsedPaneRef.current?.contains(target)) lastFocusedPaneRef.current = "collapsed";
      else lastFocusedPaneRef.current = null;
    };
    document.addEventListener("focusin", trackFocus);
    return () => document.removeEventListener("focusin", trackFocus);
  }, []);

  useLayoutEffect(() => {
    const previous = previousCompactSidebarRef.current;
    previousCompactSidebarRef.current = compactSidebar;
    if (presentation !== "auto" || previous === compactSidebar) return;
    if (lastFocusedPaneRef.current !== (previous ? "collapsed" : "expanded")) return;
    const target = compactSidebar
      ? collapsedPaneRef.current?.querySelector<HTMLButtonElement>("[data-session-rail-expand]")
      : expandedPaneRef.current?.querySelector<HTMLButtonElement>("[data-session-rail-collapse]");
    target?.focus();
  }, [compactSidebar, presentation]);

  const sessionHeaderProps = {
    channelFilter,
    onChannelFilterChange: setChannelFilter,
    onNewSession,
    onToggleSidebar: onClosePanel ?? toggleSidebar,
  };

  const sessionBodyProps = {
    sessions: filteredSessions,
    totalSessionCount: sessionList.length,
    catalogSynced: sessionCatalogSynced,
    query: searchQuery,
    onQueryChange: setSearchQuery,
    activeSessionId: active,
    historyLoadingIds,
    onNewSession,
    onSelectSession: (sessionId: string) => {
      select(sessionId);
      onSessionSelected?.();
    },
    onRenameSession: openRename,
    onDeleteSession: confirmDeleteSession,
    selectionMode,
    selectedSessionIds,
    selectedSessionCount,
    onToggleSelectionMode: () => {
      if (selectionMode) {
        setSelectionMode(false);
        setSelectedSessionIds(new Set());
      } else {
        setSelectionMode(true);
      }
    },
    onToggleSessionSelection: (sessionId: string) => {
      setSelectedSessionIds((current) => {
        const next = new Set(current);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
    },
    onToggleVisibleSelection: () => {
      setSelectedSessionIds((current) => {
        const next = new Set(current);
        const visibleIds = filteredSessions.map((session) => session.sessionId);
        const allSelected = visibleIds.length > 0 && visibleIds.every((sessionId) => next.has(sessionId));
        for (const sessionId of visibleIds) {
          if (allSelected) next.delete(sessionId);
          else next.add(sessionId);
        }
        return next;
      });
    },
    onDeleteSelected: confirmDeleteSelected,
  };

  const userFooterProps = {
    profile: userProfile,
    socketStatus,
    onSettingsIntent,
    onOpenSettings,
    onUpdateProfile: onUpdateUserProfile,
    onLogout,
    httpBaseUrl,
    uploadCsrfToken,
  };

  const content = (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col bg-surface-sidebar",
        presentation === "auto"
          ? "m-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] overflow-hidden rounded-[12px] border border-line-subtle [box-shadow:var(--theme-surface-shadow)]"
          : "w-full border-r border-line-subtle",
      )}
      data-session-sidebar
      data-session-surface={presentation}
      data-collapsed={compactSidebar}
      data-ui-chrome
    >
      {presentation === "auto" ? (
        <div className="relative h-full w-full">
          <div
            ref={expandedPaneRef}
            data-session-pane="expanded"
            className={cn(
              "absolute inset-0 flex min-h-0 flex-col gap-3 p-3 transition-opacity duration-150",
              compactSidebar ? "pointer-events-none opacity-0" : "opacity-100",
            )}
            aria-hidden={compactSidebar}
            inert={compactSidebar}
          >
            <SessionHeader {...sessionHeaderProps} collapsed={false} compactFrame dragRegion={!compactSidebar} />
            <SessionPanelBody {...sessionBodyProps} compactFrame />
            <UserFooter {...userFooterProps} collapsed={false} compactFrame />
          </div>

          <div
            ref={collapsedPaneRef}
            data-session-pane="collapsed"
            className={cn(
              "absolute inset-0 flex min-h-0 flex-col transition-opacity duration-150",
              compactSidebar ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={!compactSidebar}
            inert={!compactSidebar}
          >
            <SessionHeader {...sessionHeaderProps} collapsed compactFrame={false} dragRegion={compactSidebar} />
            <UserFooter {...userFooterProps} collapsed compactFrame={false} />
          </div>
        </div>
      ) : (
        <>
          <SessionHeader {...sessionHeaderProps} collapsed={false} compactFrame={false} />
          <SessionPanelBody {...sessionBodyProps} compactFrame={false} />
          <UserFooter {...userFooterProps} collapsed={false} compactFrame={false} />
        </>
      )}
    </aside>
  );

  return (
    <>
      {content}
      <RenameDialog
        open={!!renaming}
        value={renameDraft}
        title={renaming?.title ?? ""}
        returnFocus={dialogReturnFocusRef.current}
        onValueChange={setRenameDraft}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSubmit={submitRename}
      />
      <ConfirmationDialog
        intent={confirmation}
        returnFocus={dialogReturnFocusRef.current}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      />
    </>
  );
}
