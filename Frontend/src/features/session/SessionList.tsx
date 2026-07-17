import { useMemo, useState } from "react";
import { PencilLine, Plug, RotateCw, SquarePen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useResponsiveMode } from "../../shared/responsive";
import { useStore, type SessionRecord, type UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConfirmationDialog, RenameDialog } from "./SessionDialogs";
import { UserFooter } from "./ProfileFooter";
import { SessionHeader } from "./SessionChrome";
import { SessionPanelBody } from "./SessionPanelBody";
import type { ConfirmationIntent, SessionMenuSection } from "./types";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { SettingsSectionId } from "../settings/types";

interface Props {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => boolean;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  onLogout?: () => Promise<void>;
  socketStatus: string;
  onOpenSettings: (section?: SettingsSectionId, returnFocus?: HTMLElement | null) => void;
  presentation?: "auto" | "panel";
  onSessionSelected?: () => void;
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
  onOpenSettings,
  presentation = "auto",
  onSessionSelected,
  onClosePanel,
}: Props): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.sessionOrder);
  const active = useStore((s) => s.activeSessionId);
  const historyLoadingIds = useStore((s) => s.historyLoadingIds);
  const select = useStore((s) => s.selectSession);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const { viewport } = useResponsiveMode();
  const showInlineRowActions = viewport === "mobile" || viewport === "tablet";

  const [confirmation, setConfirmation] = useState<ConfirmationIntent | null>(null);
  const [renaming, setRenaming] = useState<RenameIntent | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const sessionList = useMemo(
    () => order.map((id) => sessions[id]).filter((session): session is SessionRecord => !!session),
    [order, sessions],
  );

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredSessions = normalizedSearchQuery
    ? sessionList.filter((session) => session.title.toLocaleLowerCase().includes(normalizedSearchQuery))
    : sessionList;

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
    if (onRenameSession(renaming.sessionId, nextTitle) === false) return;
    setRenaming(null);
    toast.success(frontendMessage("session.renameSucceeded"));
  };

  const confirmDeleteSession = (session: SessionRecord): void => {
    setConfirmation({
      title: frontendMessage("runtime.migrated.features.session.SessionList.96.14"),
      description: frontendMessage("runtime.migrated.features.session.SessionList.97.20", { value0: session.title }),
      confirmLabel: "永久删除",
      tone: "danger",
      details: ["删除后会话列表、消息历史和后端 SQLite 记录都会移除。", "这个操作不能通过刷新恢复。"],
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
      title: frontendMessage("runtime.migrated.features.session.SessionList.112.14"),
      description: frontendMessage("runtime.migrated.features.session.SessionList.113.20", { value0: ids.length }),
      confirmLabel: "全部永久删除",
      tone: "danger",
      details: ["每个会话都会发送后端删除请求。", "删除完成后，刷新也不会恢复这些历史。"],
      onConfirm: () => {
        onCloseSessions(ids);
        toast.success(frontendMessage("session.bulkDeleteRequested", { count: ids.length }));
      },
    });
  };

  const menuSections = [
    {
      section: "对话",
      items: [
        {
          id: "new",
          label: frontendMessage("runtime.migrated.features.session.SessionList.130.18"),
          icon: <SquarePen className="h-3.5 w-3.5" />,
          shortcut: "⌘N",
          disabled: false,
          onSelect: onNewSession,
        },
        {
          id: "rename",
          label: frontendMessage("runtime.migrated.features.session.SessionList.138.18"),
          icon: <PencilLine className="h-3.5 w-3.5" />,
          disabled: !activeSession,
          onSelect: () => activeSession && openRename(activeSession),
        },
        {
          id: "delete-current",
          label: frontendMessage("runtime.migrated.features.session.SessionList.145.18"),
          icon: <Plug className="h-3.5 w-3.5" />,
          destructive: true,
          disabled: !activeSession,
          onSelect: () => activeSession && confirmDeleteSession(activeSession),
        },
      ],
    },
    {
      section: "应用",
      items: [
        {
          id: "sync",
          label: frontendMessage("runtime.migrated.features.session.SessionList.158.18"),
          icon: <RotateCw className="h-3.5 w-3.5" />,
          disabled: socketStatus !== "open",
          onSelect: onRefreshSessions,
        },
        {
          id: "delete-all",
          label: frontendMessage("runtime.migrated.features.session.SessionList.165.18"),
          icon: <Trash2 className="h-3.5 w-3.5" />,
          destructive: true,
          disabled: sessionList.length === 0,
          onSelect: confirmDeleteAllSessions,
        },
      ],
    },
  ] satisfies readonly SessionMenuSection[];

  const compactSidebar = presentation === "auto" && sidebarCollapsed;
  const panelWidthClass = presentation === "panel" ? "w-full" : compactSidebar ? "w-[58px]" : "w-[246px]";

  const content = (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-surface-sidebar transition-[width] duration-300 ease-[cubic-bezier(.32,.72,.35,1)]",
        presentation === "auto"
          ? "overflow-hidden rounded-2xl border border-line-subtle [box-shadow:var(--theme-surface-shadow)]"
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
        menuSections={menuSections}
        onNewSession={onNewSession}
        onToggleSidebar={onClosePanel ?? toggleSidebar}
      />

      {compactSidebar ? null : (
        <SessionPanelBody
          sessions={filteredSessions}
          totalSessionCount={sessionList.length}
          query={searchQuery}
          onQueryChange={setSearchQuery}
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
      )}

      <UserFooter
        collapsed={compactSidebar}
        profile={userProfile}
        socketStatus={socketStatus}
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
    </>
  );
}
