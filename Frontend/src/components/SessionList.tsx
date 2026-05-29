import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  CircleAlert,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plug,
  RotateCw,
  Settings2,
  SquarePen,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type SessionRecord, type UserProfile } from "../store/sessionStore";
import { cn, formatDuration } from "../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/ContextMenu";
import { Dialog, DialogClose, DialogContent } from "./ui/Dialog";
import { LogoMark, LogoWordmark } from "./ui/Logo";
import { ScrollArea } from "./ui/ScrollArea";
import { Tooltip } from "./ui/Tooltip";

interface Props {
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onCloseSessions: (ids: string[]) => void;
  onRefreshSessions: () => void;
  onRenameSession: (id: string, title: string) => void;
  userProfile: UserProfile;
  onUpdateUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  socketStatus: string;
}

type ConfirmationIntent = {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger" | "neutral";
  details: string[];
  onConfirm: () => void;
};

type RenameIntent = {
  sessionId: string;
  title: string;
};

type SessionAction = {
  id: string;
  label: string;
  icon: JSX.Element;
  destructive?: boolean;
  onSelect: () => void;
};

const preferenceSections = [
  {
    id: "layout",
    title: "界面",
    items: [
      {
        id: "sidebarCollapsed",
        title: "默认收起左侧栏",
        description: "保留当前侧栏状态，并在下次打开时恢复。",
      },
      {
        id: "rightPanelCollapsed",
        title: "默认收起思维面板",
        description: "保留右侧执行图面板状态，并在下次打开时恢复。",
      },
    ],
  },
] as const;

export function SessionList({
  onNewSession,
  onCloseSession,
  onCloseSessions,
  onRefreshSessions,
  onRenameSession,
  userProfile,
  onUpdateUserProfile,
  socketStatus,
}: Props): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const order = useStore((s) => s.sessionOrder);
  const active = useStore((s) => s.activeSessionId);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed);
  const historyLoadingIds = useStore((s) => s.historyLoadingIds);
  const select = useStore((s) => s.selectSession);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const setRightPanelCollapsed = useStore((s) => s.setRightPanelCollapsed);

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
  } satisfies Record<(typeof preferenceSections)[number]["items"][number]["id"], boolean>;

  const setLayoutPreference = (
    id: (typeof preferenceSections)[number]["items"][number]["id"],
    value: boolean,
  ): void => {
    const setters = {
      sidebarCollapsed: setSidebarCollapsed,
      rightPanelCollapsed: setRightPanelCollapsed,
    } satisfies Record<typeof id, (value: boolean) => void>;
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

  const content = collapsed ? (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-ink-200/70 bg-paper-100/60 py-3">
      <Tooltip content="展开侧栏" side="right" shortcut="⌘B">
        <IconButton onClick={toggleSidebar} aria-label="expand">
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
  ) : (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-ink-200/70 bg-paper-100/70">
      <div className="flex h-14 items-center gap-1.5 px-2.5">
        <Tooltip content="收起侧栏" side="bottom" shortcut="⌘B">
          <IconButton onClick={toggleSidebar} aria-label="collapse">
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
                    destructive={"destructive" in item ? item.destructive : false}
                    disabled={item.disabled}
                    shortcut={"shortcut" in item ? item.shortcut : undefined}
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
              {sessionList.map((session) => {
                const isActive = session.sessionId === active;
                const lastRun = session.runs[session.runs.length - 1];
                const isRunning = lastRun?.status === "running";
                const hasFailed = lastRun?.status === "failed";
                const isHistoryLoading = !!historyLoadingIds[session.sessionId];
                const subtitle = isRunning
                  ? "正在思考…"
                  : hasFailed
                    ? "上次运行失败"
                    : session.messageCount > 0
                      ? lastRun
                        ? `${session.messageCount} 条消息 · ${formatDuration(lastRun.startedAt, lastRun.endedAt)}`
                        : isHistoryLoading
                          ? `${session.messageCount} 条消息 · 同步中`
                          : `${session.messageCount} 条消息`
                      : isHistoryLoading
                        ? "同步中"
                        : "尚无消息";

                return (
                  <SessionRow
                    key={session.sessionId}
                    active={isActive}
                    title={session.title}
                    subtitle={subtitle}
                    accent={isRunning ? "running" : hasFailed ? "failed" : "idle"}
                    onClick={() => select(session.sessionId)}
                    onRename={() => openRename(session)}
                    onClose={() => confirmDeleteSession(session)}
                  />
                );
              })}
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
        onValueChange={setLayoutPreference}
        onOpenChange={setPreferencesOpen}
      />
    </>
  );
}

const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-300",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

interface SessionRowProps {
  active: boolean;
  title: string;
  subtitle: string;
  accent: "idle" | "running" | "failed";
  onClick: () => void;
  onRename: () => void;
  onClose: () => void;
}

function SessionRow({
  active,
  title,
  subtitle,
  accent,
  onClick,
  onRename,
  onClose,
}: SessionRowProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const actions: SessionAction[] = [
    {
      id: "rename",
      label: "重命名",
      icon: <PencilLine className="h-3.5 w-3.5" />,
      onSelect: onRename,
    },
    {
      id: "delete",
      label: "删除历史",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      destructive: true,
      onSelect: onClose,
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onClick}
          className={cn(
            "group relative mt-0.5 grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_28px] items-start gap-2 rounded-lg px-2.5 py-2 transition",
            "data-[state=open]:bg-ink-900/[0.055]",
            active
              ? "bg-ink-900/[0.055] text-ink-900"
              : "text-ink-700 hover:bg-ink-900/[0.03]",
          )}
        >
          <div className="mt-0.5 grid h-5 w-5 place-items-center">
            {accent === "running" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-terra-500 shadow-[0_0_0_4px_rgba(179,68,31,0.18)]" />
            ) : accent === "failed" ? (
              <span className="block h-1.5 w-1.5 rounded-full bg-brick-500" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-ink-500" />
            )}
          </div>
          <div className="min-w-0 overflow-hidden pr-1">
            <div className="flex min-w-0 items-center gap-1">
              <span
                title={title}
                className="block min-w-0 max-w-full truncate text-[13px] font-medium leading-tight"
              >
                {title}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-400">
              {subtitle}
            </div>
          </div>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "grid h-6 w-6 place-items-center justify-self-end rounded text-ink-400 transition hover:bg-ink-900/[0.06] hover:text-ink-800",
                  menuOpen || active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-label="more"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[190px]">
              <DropdownSessionActions actions={actions} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[196px]">
        <ContextMenuLabel>会话操作</ContextMenuLabel>
        <ContextSessionActions actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function DropdownSessionActions({ actions }: { actions: SessionAction[] }): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {index === actions.length - 1 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            icon={action.icon}
            destructive={action.destructive}
            onSelect={action.onSelect}
          >
            {action.label}
          </DropdownMenuItem>
        </div>
      ))}
    </>
  );
}

function ContextSessionActions({ actions }: { actions: SessionAction[] }): JSX.Element {
  return (
    <>
      {actions.map((action, index) => (
        <div key={action.id}>
          {index === actions.length - 1 ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            icon={action.icon}
            destructive={action.destructive}
            onSelect={action.onSelect}
          >
            {action.label}
          </ContextMenuItem>
        </div>
      ))}
    </>
  );
}

function RenameDialog({
  open,
  title,
  value,
  onValueChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="重命名会话"
        description={title}
        className="w-[min(440px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4"
        >
          <input
            autoFocus
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-terra-200/50"
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              >
                取消
              </button>
            </DialogClose>
            <button
              type="submit"
              className="h-8 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800"
            >
              保存
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationDialog({
  intent,
  onOpenChange,
}: {
  intent: ConfirmationIntent | null;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={!!intent} onOpenChange={onOpenChange}>
      <DialogContent
        title={intent?.title ?? ""}
        description={intent?.description}
        className="w-[min(480px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <div className="rounded-lg border border-ink-200/70 bg-paper-100/70 p-3">
          <div className="flex gap-2.5">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brick-500" />
            <div className="space-y-1.5">
              {intent?.details.map((detail) => (
                <p key={detail} className="text-[12.5px] leading-5 text-ink-600">
                  {detail}
                </p>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose asChild>
            <button
              type="button"
              className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
            >
              取消
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={() => {
              intent?.onConfirm();
              onOpenChange(false);
            }}
            className={cn(
              "h-8 rounded-md px-3 text-[12.5px] font-medium transition",
              "bg-brick-500 text-paper-50 hover:bg-brick-600",
            )}
          >
            {intent?.confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreferencesDialog({
  open,
  values,
  onValueChange,
  onOpenChange,
}: {
  open: boolean;
  values: Record<(typeof preferenceSections)[number]["items"][number]["id"], boolean>;
  onValueChange: (
    id: (typeof preferenceSections)[number]["items"][number]["id"],
    value: boolean,
  ) => void;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="偏好设置"
        description="这些设置会保存在当前浏览器。"
        className="w-[min(520px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <div className="space-y-4">
          {preferenceSections.map((section) => (
            <section key={section.id}>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-400">
                {section.title}
              </div>
              <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
                {section.items.map((item, index) => (
                  <PreferenceToggle
                    key={item.id}
                    title={item.title}
                    description={item.description}
                    checked={values[item.id]}
                    separated={index > 0}
                    onCheckedChange={(checked) => onValueChange(item.id, checked)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreferenceToggle({
  title,
  description,
  checked,
  separated,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  separated?: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-ink-900/[0.035]",
        separated && "border-t border-ink-200/60",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-5 text-ink-500">{description}</span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition",
          checked ? "bg-ink-900" : "bg-ink-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

function EmptyState({ onNewSession }: { onNewSession: () => void }): JSX.Element {
  return (
    <div className="mt-8 flex flex-col items-center px-4 text-center">
      <LogoMark size={24} />
      <div className="mt-2 text-[13px] text-ink-700">还没有对话</div>
      <button
        type="button"
        onClick={onNewSession}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-paper-50 px-2.5 py-1 text-[12px] text-ink-800 transition hover:border-ink-300 hover:bg-paper-200/60"
      >
        <SquarePen className="h-3 w-3" />
        开始新对话
      </button>
    </div>
  );
}

function ConnectionDot({ status }: { status: string }): JSX.Element {
  const color =
    status === "open"
      ? "bg-moss-500"
      : status === "connecting" || status === "idle"
        ? "bg-terra-400"
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

function UserFooter({
  profile,
  socketStatus,
  onUpdateProfile,
}: {
  profile: UserProfile;
  socketStatus: string;
  onUpdateProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const statusLabel =
    socketStatus === "open"
      ? "已连接"
      : socketStatus === "connecting" || socketStatus === "idle"
        ? "连接中"
        : socketStatus === "error"
          ? "连接错误"
          : "已断开";
  const statusColor =
    socketStatus === "open"
      ? "bg-moss-500"
      : socketStatus === "connecting" || socketStatus === "idle"
        ? "bg-terra-400 animate-pulse"
        : "bg-brick-500";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-14 w-full items-center gap-2 border-t border-ink-200/70 px-3 text-left transition hover:bg-ink-900/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-terra-300"
      >
        <UserAvatar profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-800">{profile.name}</div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-ink-400">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusColor)} />
            {statusLabel}
          </div>
        </div>
      </button>
      <ProfileDialog
        open={open}
        profile={profile}
        onOpenChange={setOpen}
        onSubmit={(next) => {
          onUpdateProfile(next);
          setOpen(false);
          toast.success("用户资料已保存");
        }}
      />
    </>
  );
}

function UserAvatar({ profile, size = "normal" }: { profile: UserProfile; size?: "normal" | "large" }): JSX.Element {
  const className = size === "large"
    ? "h-14 w-14 rounded-full text-[18px]"
    : "h-8 w-8 rounded-full text-[12px]";
  const initial = profile.name.trim().slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-ink-900 font-semibold text-paper-50 ring-1 ring-ink-900/10",
        className,
      )}
    >
      {profile.avatarDataUrl ? (
        <img src={profile.avatarDataUrl} alt={profile.name} className="h-full w-full object-cover" />
      ) : initial ? (
        initial
      ) : (
        <User className={size === "large" ? "h-5 w-5" : "h-3.5 w-3.5"} />
      )}
    </div>
  );
}

const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 256;
const AVATAR_PREVIEW_SIZE = 192;
const AVATAR_OUTPUT_QUALITY = 0.88;

type AvatarCropState = {
  source: string;
  scale: number;
  offsetX: number;
  offsetY: number;
};

type LoadedAvatarImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
};

function ProfileDialog({
  open,
  profile,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  profile: UserProfile;
  onOpenChange: (open: boolean) => void;
  onSubmit: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
}): JSX.Element {
  const [draftName, setDraftName] = useState(profile.name);
  const [draftAvatar, setDraftAvatar] = useState<string | null>(profile.avatarDataUrl);
  const [crop, setCrop] = useState<AvatarCropState | null>(null);

  const resetDraft = (): void => {
    setDraftName(profile.name);
    setDraftAvatar(profile.avatarDataUrl);
    setCrop(null);
  };

  const readAvatarFile = (file: File): void => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      toast.error("图片不能超过 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        setCrop({
          source: result,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        });
      }
    };
    reader.onerror = () => toast.error("读取头像失败");
    reader.readAsDataURL(file);
  };

  const applyCroppedAvatar = (dataUrl: string): void => {
    setDraftAvatar(dataUrl);
    setCrop(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) resetDraft();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        title="用户资料"
        description="名称和头像会同步到消息展示。"
        className="w-[min(420px,calc(100vw-28px))]"
        bodyClassName="p-4"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const name = draftName.trim();
            if (!name) {
              toast.error("名称不能为空");
              return;
            }
            if (crop) {
              toast.error("请先完成头像裁切");
              return;
            }
            onSubmit({ name, avatarDataUrl: draftAvatar });
          }}
        >
          {crop ? (
            <AvatarCropper
              crop={crop}
              onCropChange={setCrop}
              onCancel={() => setCrop(null)}
              onApply={applyCroppedAvatar}
            />
          ) : (
            <AvatarPicker
              name={draftName || profile.name}
              avatarDataUrl={draftAvatar}
              updatedAt={profile.updatedAt}
              onReadFile={readAvatarFile}
              onRemove={() => setDraftAvatar(null)}
            />
          )}

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-600">显示名称</span>
            <input
              autoFocus
              value={draftName}
              maxLength={48}
              onChange={(event) => setDraftName(event.target.value)}
              className="h-10 w-full rounded-lg border border-ink-200 bg-paper-50 px-3 text-[13px] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-ink-300 focus:ring-2 focus:ring-terra-200/50"
              placeholder="输入你的名称"
            />
          </label>

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <button
                type="button"
                className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              >
                取消
              </button>
            </DialogClose>
            <button
              type="submit"
              className="h-8 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800"
            >
              保存
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AvatarPicker({
  name,
  avatarDataUrl,
  updatedAt,
  onReadFile,
  onRemove,
}: {
  name: string;
  avatarDataUrl: string | null;
  updatedAt: string;
  onReadFile: (file: File) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200/70 bg-paper-100/65">
      <div className="flex items-center gap-4 p-3">
        <UserAvatar
          profile={{ name, avatarDataUrl, updatedAt }}
          size="large"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink-900">头像</div>
          <div className="mt-1 text-[12px] leading-5 text-ink-500">
            选择图片后可移动和缩放裁切。
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800">
              <Camera className="h-3.5 w-3.5" />
              选择图片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) onReadFile(file);
                }}
              />
            </label>
            {avatarDataUrl ? (
              <button
                type="button"
                onClick={onRemove}
                className="h-8 rounded-md px-2.5 text-[12.5px] text-ink-500 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
              >
                移除
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AvatarCropper({
  crop,
  onCropChange,
  onApply,
  onCancel,
}: {
  crop: AvatarCropState;
  onCropChange: (crop: AvatarCropState) => void;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const image = useLoadedAvatarImage(crop.source);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const geometry = useMemo(
    () => image ? resolveAvatarCropGeometry(image, crop, AVATAR_PREVIEW_SIZE) : null,
    [crop, image],
  );

  useEffect(() => {
    if (!image) return;
    const normalized = normalizeAvatarCrop(crop, image);
    if (normalized !== crop) onCropChange(normalized);
  }, [crop, image, onCropChange]);

  const updateScale = (scale: number): void => {
    if (!image) return;
    onCropChange(normalizeAvatarCrop({ ...crop, scale }, image));
  };

  const handleApply = (): void => {
    if (!image) return;
    onApply(renderAvatarCrop(image, crop));
  };

  return (
    <div className="rounded-xl border border-ink-200/70 bg-paper-100/65 p-3">
      <div className="flex flex-col items-center">
        <div
          ref={frameRef}
          className={cn(
            "relative h-48 w-48 touch-none overflow-hidden rounded-full bg-ink-950 select-none",
            "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_10px_30px_rgba(23,20,18,0.14)]",
          )}
          onPointerDown={(event) => {
            if (!image) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              offsetX: crop.offsetX,
              offsetY: crop.offsetY,
            };
          }}
          onPointerMove={(event) => {
            if (!image || !dragRef.current) return;
            const frame = frameRef.current;
            if (!frame) return;
            const unit = AVATAR_PREVIEW_SIZE / frame.clientWidth;
            const next = {
              ...crop,
              offsetX: dragRef.current.offsetX + (event.clientX - dragRef.current.x) * unit,
              offsetY: dragRef.current.offsetY + (event.clientY - dragRef.current.y) * unit,
            };
            onCropChange(normalizeAvatarCrop(next, image));
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onWheel={(event) => {
            if (!image) return;
            event.preventDefault();
            const nextScale = crop.scale + (event.deltaY < 0 ? 0.05 : -0.05);
            updateScale(nextScale);
          }}
        >
          {geometry ? (
            <img
              src={crop.source}
              alt="头像裁切预览"
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: geometry.width,
                height: geometry.height,
                transform: `translate(calc(-50% + ${geometry.offsetX}px), calc(-50% + ${geometry.offsetY}px))`,
              }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-[12px] text-paper-50/70">
              加载图片中
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-paper-50/65" />
        </div>

        <label className="mt-4 w-full">
          <div className="mb-2 flex items-center justify-between text-[12px] text-ink-500">
            <span>缩放</span>
            <span className="font-mono">{Math.round(crop.scale * 100)}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={crop.scale}
            onChange={(event) => updateScale(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer accent-ink-900"
          />
        </label>

        <div className="mt-4 flex w-full justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-md px-3 text-[12.5px] text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            取消裁切
          </button>
          <button
            type="button"
            disabled={!image}
            onClick={handleApply}
            className="h-8 rounded-md bg-ink-900 px-3 text-[12.5px] font-medium text-paper-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            使用头像
          </button>
        </div>
      </div>
    </div>
  );
}

function useLoadedAvatarImage(source: string): LoadedAvatarImage | null {
  const [image, setImage] = useState<LoadedAvatarImage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    const element = new Image();
    element.onload = () => {
      if (cancelled) return;
      setImage({
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
      });
    };
    element.onerror = () => {
      if (!cancelled) toast.error("图片加载失败");
    };
    element.src = source;
    return () => {
      cancelled = true;
    };
  }, [source]);

  return image;
}

function resolveAvatarCropGeometry(
  image: LoadedAvatarImage,
  crop: AvatarCropState,
  frameSize = AVATAR_OUTPUT_SIZE,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const baseScale = Math.max(frameSize / image.width, frameSize / image.height);
  const scale = baseScale * crop.scale;
  return {
    width: image.width * scale,
    height: image.height * scale,
    offsetX: crop.offsetX,
    offsetY: crop.offsetY,
  };
}

function normalizeAvatarCrop(crop: AvatarCropState, image: LoadedAvatarImage): AvatarCropState {
  const scale = Math.min(3, Math.max(1, crop.scale));
  const geometry = resolveAvatarCropGeometry(image, { ...crop, scale }, AVATAR_PREVIEW_SIZE);
  const maxOffsetX = Math.max(0, (geometry.width - AVATAR_PREVIEW_SIZE) / 2);
  const maxOffsetY = Math.max(0, (geometry.height - AVATAR_PREVIEW_SIZE) / 2);
  const offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, crop.offsetX));
  const offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, crop.offsetY));

  if (scale === crop.scale && offsetX === crop.offsetX && offsetY === crop.offsetY) return crop;
  return {
    ...crop,
    scale,
    offsetX,
    offsetY,
  };
}

function renderAvatarCrop(image: LoadedAvatarImage, crop: AvatarCropState): string {
  const normalized = normalizeAvatarCrop(crop, image);
  const previewGeometry = resolveAvatarCropGeometry(image, normalized, AVATAR_PREVIEW_SIZE);
  const geometry = {
    width: previewGeometry.width * (AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE),
    height: previewGeometry.height * (AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE),
  };
  const outputOffsetScale = AVATAR_OUTPUT_SIZE / AVATAR_PREVIEW_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return normalized.source;

  ctx.clearRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  ctx.drawImage(
    image.element,
    (AVATAR_OUTPUT_SIZE - geometry.width) / 2 + normalized.offsetX * outputOffsetScale,
    (AVATAR_OUTPUT_SIZE - geometry.height) / 2 + normalized.offsetY * outputOffsetScale,
    geometry.width,
    geometry.height,
  );

  return canvas.toDataURL("image/jpeg", AVATAR_OUTPUT_QUALITY);
}
