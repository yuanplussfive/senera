import { useMemo, useState } from "react";
import {
  PencilLine,
  Plug,
  RotateCw,
  Settings2,
  SquarePen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useResponsiveMode } from "../../shared/responsive";
import { useStore, type SessionRecord, type UserProfile } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { ConfirmationDialog, PreferencesDialog, RenameDialog } from "./SessionDialogs";
import { UserFooter } from "./ProfileFooter";
import { SessionHeader, SessionRail } from "./SessionChrome";
import { SessionPanelBody } from "./SessionPanelBody";
import type { ConfirmationIntent, LayoutPreferenceId, SessionMenuSection } from "./types";

interface Props {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => void;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
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
      toast.error("会话名称不能为空");
      return;
    }
    onRenameSession(renaming.sessionId, nextTitle);
    setRenaming(null);
    toast.success("已重命名");
  };

  const confirmDeleteSession = (session: SessionRecord): void => {
    setConfirmation({
      title: "删除当前会话",
      description: `「${session.title}」会从后端历史中永久删除。`,
      confirmLabel: "永久删除",
      tone: "danger",
      details: ["删除后会话列表、消息历史和后端 SQLite 记录都会移除。", "这个操作不能通过刷新恢复。"],
      onConfirm: () => {
        onCloseSession(session.sessionId);
        toast.success("已发送删除请求");
      },
    });
  };

  const confirmDeleteAllSessions = (): void => {
    const ids = sessionList.map((session) => session.sessionId);
    if (ids.length === 0) return;
    setConfirmation({
      title: "删除全部历史会话",
      description: `将永久删除 ${ids.length} 个后端会话。`,
      confirmLabel: "全部永久删除",
      tone: "danger",
      details: ["每个会话都会发送后端删除请求。", "删除完成后，刷新也不会恢复这些历史。"],
      onConfirm: () => {
        onCloseSessions(ids);
        toast.success(`已发送 ${ids.length} 个删除请求`);
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
      section: "对话",
      items: [
        {
          id: "new",
          label: "新建对话",
          icon: <SquarePen className="h-3.5 w-3.5" />,
          shortcut: "⌘N",
          disabled: false,
          onSelect: onNewSession,
        },
        {
          id: "rename",
          label: "重命名当前",
          icon: <PencilLine className="h-3.5 w-3.5" />,
          disabled: !activeSession,
          onSelect: () => activeSession && openRename(activeSession),
        },
        {
          id: "delete-current",
          label: "删除当前历史",
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
          id: "preferences",
          label: "偏好设置",
          icon: <Settings2 className="h-3.5 w-3.5" />,
          disabled: false,
          onSelect: () => setPreferencesOpen(true),
        },
        {
          id: "sync",
          label: "重新同步会话",
          icon: <RotateCw className="h-3.5 w-3.5" />,
          disabled: socketStatus !== "open",
          onSelect: onRefreshSessions,
        },
        {
          id: "delete-all",
          label: "删除全部历史",
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
    <SessionRail
      socketStatus={socketStatus}
      onNewSession={onNewSession}
      onOpenSessionPanel={handleOpenFromRail}
    />
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
