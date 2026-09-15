import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStore, type SessionRecord, type UserProfile } from "../../store/sessionStore";
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
  onCloseSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => boolean;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
  socketStatus: string;
  onSettingsIntent?: () => void;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
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
  onRenameSession,
  userProfile,
  onUpdateUserProfile,
  onLogout,
  socketStatus,
  onSettingsIntent,
  onOpenSettings,
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
        onCloseSession(session.sessionId);
        toast.success(frontendMessage("session.deleteRequested"));
      },
    });
  };

  const compactSidebar = presentation === "auto" && sidebarCollapsed;
  const compactFrame = presentation === "auto" && !compactSidebar;
  const panelWidthClass = compactSidebar ? "w-[58px]" : presentation === "auto" ? "w-[calc(100%-1.25rem)]" : "w-full";

  const content = (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-surface-sidebar transition-[width] duration-300 ease-[cubic-bezier(.32,.72,.35,1)]",
        presentation === "auto"
          ? compactSidebar
            ? "m-2.5 h-[calc(100%-1.25rem)] overflow-hidden rounded-[12px] border border-line-subtle [box-shadow:var(--theme-surface-shadow)]"
            : "m-2.5 h-[calc(100%-1.25rem)] w-[calc(100%-1.25rem)] gap-2.5 overflow-hidden rounded-[12px] border border-line-subtle p-[10px] pt-3 [box-shadow:var(--theme-surface-shadow)]"
          : "border-r border-line-subtle",
        panelWidthClass,
      )}
      data-session-sidebar
      data-session-surface={presentation}
      data-collapsed={compactSidebar}
      data-ui-chrome
    >
      <SessionHeader
        collapsed={compactSidebar}
        compactFrame={compactFrame}
        channelFilter={channelFilter}
        onChannelFilterChange={setChannelFilter}
        onNewSession={onNewSession}
        onToggleSidebar={onClosePanel ?? toggleSidebar}
      />

      {compactSidebar ? null : (
        <SessionPanelBody
          compactFrame={compactFrame}
          sessions={filteredSessions}
          totalSessionCount={sessionList.length}
          catalogSynced={sessionCatalogSynced}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          activeSessionId={active}
          historyLoadingIds={historyLoadingIds}
          onNewSession={onNewSession}
          onSelectSession={(sessionId) => {
            select(sessionId);
            onSessionSelected?.();
          }}
          onRenameSession={openRename}
          onDeleteSession={confirmDeleteSession}
        />
      )}

      <UserFooter
        collapsed={compactSidebar}
        compactFrame={compactFrame}
        profile={userProfile}
        socketStatus={socketStatus}
        onSettingsIntent={onSettingsIntent}
        onOpenSettings={onOpenSettings}
        onUpdateProfile={onUpdateUserProfile}
        onLogout={onLogout}
      />
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
