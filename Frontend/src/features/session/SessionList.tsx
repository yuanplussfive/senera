import { useMemo, useState } from "react";
import { PencilLine, Plug, RotateCw, Settings2, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useResponsiveMode } from "../../shared/responsive";
import { useStore, type SessionRecord, type UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConfirmationDialog, PreferencesDialog, RenameDialog } from "./SessionDialogs";
import { UserFooter } from "./ProfileFooter";
import { SessionHeader, SessionRail } from "./SessionChrome";
import { SessionPanelBody } from "./SessionPanelBody";
import type { ConfirmationIntent, LayoutPreferenceId, SessionMenuSection } from "./types";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

interface Props {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => void;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout: () => Promise<void>;
  socketStatus: string;
  presentation?: "auto" | "panel" | "rail";
  onSessionSelected?: () => void;
  onOpenSessionPanel?: () => void;
  onClosePanel?: () => void;
}

type RenameIntent = {
  sessionId: string;
  title: string;
};

export function SessionList({
  onNewSession,
  onCloseSession,
  onCloseSessions,
  onRefreshSessions,
  onRenameSession,
  userProfile,
  onUpdateUserProfile,
  onLogout,
  socketStatus,
  presentation = "auto",
  onSessionSelected,
  onOpenSessionPanel,
  onClosePanel,
}: Props): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.sessionOrder);
  const active = useStore((s) => s.activeSessionId);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed);
  const motionLevel = useStore((s) => s.motionLevel);
  const historyLoadingIds = useStore((s) => s.historyLoadingIds);
  const select = useStore((s) => s.selectSession);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((s) => s.setRightPanelCollapsed);
  const setMotionLevel = useStore((s) => s.setMotionLevel);
  const { prefersCompactControls, supportsHover } = useResponsiveMode();
  const showInlineRowActions = prefersCompactControls || !supportsHover;

  const [confirmation, setConfirmation] = useState<ConfirmationIntent | null>(null);
  const [renaming, setRenaming] = useState<RenameIntent | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const sessionList = useMemo(
    () => order.map((id) => sessions[id]).filter((session): session is SessionRecord => !!session),
    [order, sessions],
  );

  const activeSession = active ? sessions[active] : undefined;

  const openRename = (session: SessionRecord): void => {
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
    onRenameSession(renaming.sessionId, nextTitle);
    setRenaming(null);
    toast.success(frontendMessage("session.renameSucceeded"));
  };

  const confirmDeleteSession = (session: SessionRecord): void => {
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

  const confirmDeleteAllSessions = (): void => {
    const ids = sessionList.map((session) => session.sessionId);
    if (ids.length === 0) return;
    setConfirmation({
      title: frontendMessage("session.deleteAllHistory"),
      description: frontendMessage("session.deleteAllDescription", { count: ids.length }),
      confirmLabel: frontendMessage("session.deleteAllConfirm"),
      tone: "danger",
      details: [frontendMessage("session.deleteAllDetailRequests"), frontendMessage("session.deleteAllDetailRefresh")],
      onConfirm: () => {
        onCloseSessions(ids);
        toast.success(frontendMessage("session.bulkDeleteRequested", { count: ids.length }));
      },
    });
  };

  const layoutPreferenceValues = {
    sidebarCollapsed: collapsed,
    rightPanelCollapsed,
  } satisfies Record<LayoutPreferenceId, boolean>;

  const setLayoutPreference = (id: LayoutPreferenceId, value: boolean): void => {
    const setters = {
      sidebarCollapsed: setSidebarCollapsed,
      rightPanelCollapsed: setRightPanelCollapsed,
    } satisfies Record<LayoutPreferenceId, (value: boolean) => void>;
    setters[id](value);
  };

  const menuSections = [
    {
      section: frontendMessage("session.section"),
      items: [
        {
          id: "new",
          label: frontendMessage("session.new"),
          icon: <SquarePen className="h-3.5 w-3.5" />,
          shortcut: "⌘N",
          disabled: false,
          onSelect: onNewSession,
        },
        {
          id: "rename",
          label: frontendMessage("session.renameCurrent"),
          icon: <PencilLine className="h-3.5 w-3.5" />,
          disabled: !activeSession,
          onSelect: () => activeSession && openRename(activeSession),
        },
        {
          id: "delete-current",
          label: frontendMessage("session.deleteCurrentHistory"),
          icon: <Plug className="h-3.5 w-3.5" />,
          destructive: true,
          disabled: !activeSession,
          onSelect: () => activeSession && confirmDeleteSession(activeSession),
        },
      ],
    },
    {
      section: frontendMessage("session.appSection"),
      items: [
        {
          id: "preferences",
          label: frontendMessage("session.preferences"),
          icon: <Settings2 className="h-3.5 w-3.5" />,
          disabled: false,
          onSelect: () => setPreferencesOpen(true),
        },
        {
          id: "sync",
          label: frontendMessage("session.sync"),
          icon: <RotateCw className="h-3.5 w-3.5" />,
          disabled: socketStatus !== "open",
          onSelect: onRefreshSessions,
        },
        {
          id: "delete-all",
          label: frontendMessage("session.deleteAllHistory"),
          icon: <Trash2 className="h-3.5 w-3.5" />,
          destructive: true,
          disabled: sessionList.length === 0,
          onSelect: confirmDeleteAllSessions,
        },
      ],
    },
  ] satisfies readonly SessionMenuSection[];

  const isRail = presentation === "rail" || (presentation === "auto" && collapsed);
  const panelWidthClass = presentation === "panel" ? "w-full" : "w-[264px]";
  const handleOpenFromRail = onOpenSessionPanel ?? toggleSidebar;

  const content = isRail ? (
    <SessionRail socketStatus={socketStatus} onNewSession={onNewSession} onOpenSessionPanel={handleOpenFromRail} />
  ) : (
    <aside className={cn("flex h-full shrink-0 flex-col border-r border-ink-200/70 bg-paper-100/70", panelWidthClass)}>
      <SessionHeader
        menuSections={menuSections}
        onNewSession={onNewSession}
        onToggleSidebar={onClosePanel ?? toggleSidebar}
      />

      <SessionPanelBody
        sessions={sessionList}
        activeSessionId={active}
        historyLoadingIds={historyLoadingIds}
        showInlineRowActions={showInlineRowActions}
        onNewSession={onNewSession}
        onSelectSession={(sessionId) => {
          select(sessionId);
          onSessionSelected?.();
        }}
        onRenameSession={openRename}
        onDeleteSession={confirmDeleteSession}
      />

      <UserFooter
        profile={userProfile}
        socketStatus={socketStatus}
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
        onValueChange={setRenameDraft}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSubmit={submitRename}
      />
      <ConfirmationDialog
        intent={confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      />
      <PreferencesDialog
        open={preferencesOpen}
        values={layoutPreferenceValues}
        motionLevel={motionLevel}
        onValueChange={setLayoutPreference}
        onMotionLevelChange={setMotionLevel}
        onOpenChange={setPreferencesOpen}
      />
    </>
  );
}
