import { useMemo, useState } from "react";
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plug,
  RotateCw,
  Settings2,
  SquarePen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type SessionRecord, type UserProfile } from "../../store/sessionStore";
import { cn, formatDuration } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
import { LogoMark, LogoWordmark } from "../ui/Logo";
import { ScrollArea } from "../ui/ScrollArea";
import { Tooltip } from "../ui/Tooltip";
import { IconButton } from "./IconButton";
import { ConfirmationDialog, PreferencesDialog, RenameDialog } from "./SessionDialogs";
import { EmptyState, SessionRow } from "./SessionRows";
import { UserFooter } from "./ProfileFooter";
import type { ConfirmationIntent, LayoutPreferenceId } from "./types";
import { MotionList, MotionListItem } from "../../shared/motion";

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

  const menuItems = [
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
  ] as const;

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
        menuItems={menuItems}
        onNewSession={onNewSession}
        onToggleSidebar={toggleSidebar}
      />

      <ScrollArea className="flex-1">
        <div className="px-2 pb-3">
          {sessionList.length === 0 ? (
            <EmptyState onNewSession={onNewSession} />
          ) : (
            <>
              <div className="mt-1 px-2 pb-1.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  最近 · {sessionList.length}
                </div>
              </div>
              <MotionList>
                {sessionList.map((session, index) => {
                  const isActive = session.sessionId === active;
                  const lastRun = session.runs[session.runs.length - 1];
                  const isRunning = lastRun?.status === "running";
                  const hasFailed = lastRun?.status === "failed";
                  const isHistoryLoading = !!historyLoadingIds[session.sessionId];
                  const subtitle = formatSessionSubtitle(session, isHistoryLoading);

                  return (
                    <MotionListItem
                      key={session.sessionId}
                      index={index}
                      itemCount={sessionList.length}
                      layout="position"
                    >
                      <SessionRow
                        active={isActive}
                        sessionId={session.sessionId}
                        title={session.title}
                        subtitle={subtitle}
                        accent={isRunning ? "running" : hasFailed ? "failed" : "idle"}
                        onClick={() => {
                          select(session.sessionId);
                          onSessionSelected?.();
                        }}
                        onRename={() => openRename(session)}
                        onClose={() => confirmDeleteSession(session)}
                      />
                    </MotionListItem>
                  );
                })}
              </MotionList>
            </>
          )}
        </div>
      </ScrollArea>

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

function SessionRail({
  socketStatus,
  onNewSession,
  onOpenSessionPanel,
}: {
  socketStatus: string;
  onNewSession: () => void;
  onOpenSessionPanel: () => void;
}): JSX.Element {
  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-ink-200/70 bg-paper-100/60 py-3">
      <Tooltip content="展开侧栏" side="right" shortcut="⌘B">
        <IconButton onClick={onOpenSessionPanel} aria-label="expand">
          <PanelLeftOpen className="h-4 w-4" />
        </IconButton>
      </Tooltip>
      <div className="my-2 flex flex-col items-center">
        <LogoMark size={22} />
      </div>
      <Tooltip content="新建对话" side="right">
        <IconButton onClick={onNewSession} aria-label="new">
          <SquarePen className="h-4 w-4" />
        </IconButton>
      </Tooltip>
      <div className="mt-auto pb-1">
        <ConnectionDot status={socketStatus} />
      </div>
    </aside>
  );
}

function SessionHeader({
  menuItems,
  onNewSession,
  onToggleSidebar,
}: {
  menuItems: readonly {
    section: string;
    items: readonly {
      id: string;
      label: string;
      icon: JSX.Element;
      shortcut?: string;
      disabled: boolean;
      destructive?: boolean;
      onSelect: () => void;
    }[];
  }[];
  onNewSession: () => void;
  onToggleSidebar: () => void;
}): JSX.Element {
  return (
    <div className="flex h-14 items-center gap-1.5 px-2.5">
      <Tooltip content="收起侧栏" side="bottom" shortcut="⌘B">
        <IconButton onClick={onToggleSidebar} aria-label="collapse">
          <PanelLeftClose className="h-4 w-4" />
        </IconButton>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex h-8 flex-1 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-800 transition hover:bg-ink-900/[0.05]"
          >
            <LogoMark size={16} />
            <LogoWordmark className="text-[15px]" />
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-ink-400 transition group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[226px]">
          {menuItems.map((group, index) => (
            <div key={group.section}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{group.section}</DropdownMenuLabel>
              {group.items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  icon={item.icon}
                  destructive={item.destructive}
                  disabled={item.disabled}
                  shortcut={item.shortcut}
                  onSelect={item.onSelect}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip content="新建对话" side="bottom" shortcut="⌘N">
        <IconButton onClick={onNewSession} aria-label="new">
          <SquarePen className="h-4 w-4" />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function ConnectionDot({ status }: { status: string }): JSX.Element {
  const color =
    status === "open"
      ? "bg-moss-500"
      : status === "connecting" || status === "idle"
        ? "bg-umber-500 motion-safe:animate-pulse"
        : "bg-brick-500";
  const label =
    status === "open"
      ? "已连接"
      : status === "connecting" || status === "idle"
        ? "连接中"
        : "未连接";
  return (
    <Tooltip content={label} side="right">
      <button type="button" className="grid h-6 w-6 place-items-center">
        <span className={cn("block h-2 w-2 rounded-full", color)} />
      </button>
    </Tooltip>
  );
}

function formatSessionSubtitle(session: SessionRecord, isHistoryLoading: boolean): string {
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
