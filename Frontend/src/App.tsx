import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "./shared/ui";
import { useAgentSocket } from "./api/useAgentSocket";
import { useStore, type ChatMessage } from "./store/sessionStore";
import { SessionList } from "./components/SessionList";
import { ChatPanel } from "./components/ChatPanel";
import { ThinkingTimeline } from "./components/ThinkingTimeline";
import { AppShell, useMediaQuery } from "./components/layout/AppShell";
import { EventKinds, type WsRequest } from "./api/eventTypes";
import { generateId } from "./lib/util";
import type { UserProfileData } from "./api/eventTypes";
import { useGlobalShortcuts } from "./app/useGlobalShortcuts";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8787";
const RECOVERY_POLL_DELAYS_MS = [1500, 2000, 3000, 5000] as const;

type PendingAfterTruncate = {
  sessionId: string;
  requestId: string;
  nextInput: string;
  modelProviderId?: string;
};

export function App(): JSX.Element {
  const ingest = useStore((s) => s.ingest);
  const registerSession = useStore((s) => s.registerCreatingSession);
  const clearAllSessions = useStore((s) => s.clearAllSessions);
  const removeSession = useStore((s) => s.removeSession);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const renameSession = useStore((s) => s.renameSession);
  const activeId = useStore((s) => s.activeSessionId);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed);
  const markHistoryLoading = useStore((s) => s.markHistoryLoading);
  const markHistoryLoadFailed = useStore((s) => s.markHistoryLoadFailed);
  const modelProviders = useStore((s) => s.modelProviders);
  const selectedModelProviderId = useStore((s) => s.selectedModelProviderId);
  const selectModelProvider = useStore((s) => s.selectModelProvider);
  const userProfile = useStore((s) => s.userProfile);
  const setUserProfile = useStore((s) => s.setUserProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);
  const recoveryPollingKey = useStore((s) =>
    Object.values(s.sessions)
      .flatMap((session) =>
        session.runs
          .filter((run) => run.status === "running" && run.recoverySource === "history")
          .map((run) => [
            session.sessionId,
            run.requestId,
            String(run.revision),
            s.historyLoadingIds[session.sessionId] ? "loading" : "idle",
          ].join("\u0001")),
      )
      .sort()
      .join("\u0000"),
  );
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [workflowDrawerOpen, setWorkflowDrawerOpen] = useState(false);
  const hasPersistentSessionPanel = useMediaQuery("(min-width: 1280px)");
  const hasPersistentWorkflowPanel = useMediaQuery("(min-width: 1024px)");

  const handleOpenSessionPanel = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      setSidebarCollapsed(false);
      return;
    }
    setSessionDrawerOpen(true);
  }, [hasPersistentSessionPanel, setSidebarCollapsed]);

  // 哪些 sessionId 已经被当前 WS 连接的后端确认存在
  const serverKnownRef = useRef<Set<string>>(new Set());
  const sendRef = useRef<((req: WsRequest) => boolean) | null>(null);
  const lastSendRef = useRef<{
    sessionId: string;
    requestId: string;
    input: string;
    modelProviderId?: string;
  } | null>(null);
  const hydrationToastShownRef = useRef(false);
  const recoveryPollingAttemptRef = useRef(0);
  // 待办的"truncate 完后做点啥"队列——避免 setTimeout 魔法等待
  const pendingAfterTruncateRef = useRef<PendingAfterTruncate[]>([]);

  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvent: useCallback(
      (env) => {
        // 标记 session 已被后端确认
        if (
          (env.kind === EventKinds.SessionCreated || env.kind === EventKinds.SessionSnapshot) &&
          env.sessionId
        ) {
          serverKnownRef.current.add(env.sessionId);
        }
        if (env.kind === EventKinds.SessionClosed && env.sessionId) {
          serverKnownRef.current.delete(env.sessionId);
        }

        // session.message 的 not_found 可自愈重放；history / close 不做自动 create
        if (env.kind === EventKinds.SessionNotFound && env.sessionId && sendRef.current) {
          const data = env.data as {
            sessionId: string;
            operation: "session.message" | "session.close" | "session.history";
            message?: string;
          };
          const lost = env.sessionId;
          serverKnownRef.current.delete(lost);
          if (data.operation === "session.history") {
            ingest(env);
            toast.warning("该本地会话在后端不存在", {
              description: "已切换到仍存在历史的会话。旧的本地占位不会再被自动恢复成空会话。",
            });
            return;
          }
          if (data.operation === "session.close") {
            if (sendRef.current) sendRef.current({ type: "session.list" });
            toast("会话已从本地列表移除", {
              description: "后端已不存在该会话。",
            });
            return;
          }
          sendRef.current({ type: "session.create", sessionId: lost });
          serverKnownRef.current.add(lost);
          // 如果丢失的就是最后一次发送的请求，自动重放一次
          const last = lastSendRef.current;
          if (last && last.sessionId === lost) {
            sendRef.current({
              type: "session.message",
              sessionId: lost,
              requestId: last.requestId,
              input: last.input,
              modelProviderId: last.modelProviderId,
            });
            toast("已自动恢复会话", {
              description: "后端不再保留先前上下文，但消息记录在前端完整保留。",
            });
          }
          return;
        }

        // 其他错误 toast
        if (env.kind === EventKinds.RunFailed) {
          const state = useStore.getState();
          const session = env.sessionId ? state.sessions[env.sessionId] : null;
          const hasMatchingRun = session?.runs.some((run) => run.requestId === env.requestId) ?? false;
          if (env.sessionId && state.historyLoadingIds[env.sessionId] && !hasMatchingRun) {
            toast.error("历史同步失败", {
              description: (env.data as { message?: string }).message ?? "",
            });
          } else {
            toast.error("运行失败", {
              description: (env.data as { message?: string }).message ?? "",
            });
          }
        } else if (env.kind === EventKinds.SessionBusy) {
          toast.warning("会话正忙，请等待当前请求结束");
        } else if (env.kind === EventKinds.ToolCallFailed) {
          const d = env.data as { toolName?: string; message?: string };
          toast.error(`工具调用失败: ${d.toolName ?? ""}`, { description: d.message });
        } else if (env.kind === EventKinds.RequestInvalid) {
          toast.error("请求格式错误", {
            description: (env.data as { message?: string }).message ?? "",
          });
        }

        ingest(env);

        if (env.kind === EventKinds.ConfigReloaded && sendRef.current) {
          sendRef.current({ type: "model.list" });
        }

        if (env.kind === EventKinds.ProfileSnapshot) {
          markUserProfileSynced(env.data as UserProfileData);
        }

        // truncate 完成后，执行排队的"重新回答"等动作（消除 setTimeout race）
        // 注意：必须先 ingest（让 store 完成 truncate），再 append 新的 user message，
        // 否则 SessionTruncated 的 slice 会把刚 append 的消息一起裁掉，导致 UI 瞬间消失。
        if (env.kind === EventKinds.SessionTruncated && env.sessionId && sendRef.current) {
          const data = env.data as { sessionId: string; fromRequestId: string };
          const queue = pendingAfterTruncateRef.current;
          const idx = queue.findIndex(
            (p) => p.sessionId === data.sessionId && p.requestId === data.fromRequestId,
          );
          if (idx >= 0) {
            const pending = queue[idx];
            queue.splice(idx, 1);
            const newRequestId = generateId();
            const messageRequest = {
              type: "session.message" as const,
              sessionId: pending.sessionId,
              requestId: newRequestId,
              modelProviderId: pending.modelProviderId,
              input: pending.nextInput,
            };
            const ok = sendRef.current(messageRequest);
            if (!ok) {
              toast.error("重新发送失败，连接可能已断开");
              return;
            }
            lastSendRef.current = {
              sessionId: pending.sessionId,
              requestId: newRequestId,
              input: pending.nextInput,
              modelProviderId: pending.modelProviderId,
            };
            useStore
              .getState()
              .appendUserMessage(pending.sessionId, newRequestId, pending.nextInput);
          }
        }

      },
      [ingest, markUserProfileSynced],
    ),
  });

  const requestSessionHistory = useCallback(
    (sessionId: string, options: { refresh?: boolean } = {}): boolean => {
      markHistoryLoading(sessionId);
      const ok = send({ type: "session.history", sessionId, refresh: options.refresh || undefined });
      if (!ok) {
        markHistoryLoadFailed(sessionId);
        toast.error("历史同步失败，连接可能已断开");
      }
      return ok;
    },
    [markHistoryLoadFailed, markHistoryLoading, send],
  );

  useEffect(() => {
    if (status !== "open" || !recoveryPollingKey) {
      recoveryPollingAttemptRef.current = 0;
      return;
    }

    const sessionIds = [
      ...new Set(recoveryPollingKey.split("\u0000").map((entry) => entry.split("\u0001")[0]).filter(Boolean)),
    ];
    const idleSessionIds = sessionIds.filter((sessionId) => !useStore.getState().historyLoadingIds[sessionId]);
    if (idleSessionIds.length === 0) {
      return;
    }

    const attempt = recoveryPollingAttemptRef.current;
    const delay = RECOVERY_POLL_DELAYS_MS[Math.min(attempt, RECOVERY_POLL_DELAYS_MS.length - 1)];
    const timer = window.setTimeout(() => {
      const state = useStore.getState();
      let requested = false;
      for (const sessionId of idleSessionIds) {
        const session = state.sessions[sessionId];
        const stillNeedsRecovery = session?.runs.some(
          (run) => run.status === "running" && run.recoverySource === "history",
        );
        if (!stillNeedsRecovery || state.historyLoadingIds[sessionId]) continue;
        requestSessionHistory(sessionId, { refresh: true });
        requested = true;
      }
      if (requested) {
        recoveryPollingAttemptRef.current = Math.min(attempt + 1, RECOVERY_POLL_DELAYS_MS.length - 1);
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [recoveryPollingKey, requestSessionHistory, status]);

  // 暴露 send 给 ref，让事件回调能用最新的 send
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // 一旦连上：重置「后端已知 session」，拉 list 拿权威目录
  useEffect(() => {
    if (status !== "open") {
      serverKnownRef.current = new Set();
      return;
    }
    serverKnownRef.current = new Set();

    // 拉后端权威会话列表（覆盖本地缓存的元数据）
    send({ type: "session.list" });
    send({ type: "model.list" });

    const state = useStore.getState();
    if (state.userProfile.syncState === "pending") {
      const { name, avatarDataUrl } = state.userProfile;
      send({ type: "profile.update", profile: { name, avatarDataUrl } });
    } else {
      send({ type: "profile.get" });
    }

    if (!hydrationToastShownRef.current && state.sessionOrder.length > 0) {
      hydrationToastShownRef.current = true;
      const persistedCount = state.sessionOrder.length;
      if (persistedCount > 0) {
        toast.success(`恢复 ${persistedCount} 个会话`, {
          description: "正在从后端同步消息历史…",
        });
      }
    }
  }, [status, send, registerSession]);

  // 切换会话：1) 确保后端认识；2) 若历史未加载则拉 history
  useEffect(() => {
    if (status !== "open" || !activeId) return;
    const state = useStore.getState();
    if (state.missingOnServerIds[activeId]) {
      return;
    }
    if (!state.historyLoadedIds[activeId] && !state.historyLoadingIds[activeId]) {
      requestSessionHistory(activeId);
    }
  }, [activeId, status, requestSessionHistory]);

  const handleNewSession = useCallback(() => {
    if (status !== "open") {
      toast.warning("后端未连接，无法新建会话");
      return;
    }
    const id = generateId();
    const ok = send({ type: "session.create", sessionId: id });
    if (!ok) {
      toast.error("新建失败，连接可能已断开");
      return;
    }
    registerSession(id);
    serverKnownRef.current.add(id);
  }, [status, send, registerSession]);

  const handleToggleSessionPanelShortcut = useCallback((): void => {
    if (hasPersistentSessionPanel) {
      toggleSidebar();
      return;
    }
    setSessionDrawerOpen((open) => !open);
  }, [hasPersistentSessionPanel, toggleSidebar]);

  useGlobalShortcuts({
    onNewSession: handleNewSession,
    onToggleSessionPanel: handleToggleSessionPanelShortcut,
  });

  const handleCloseSession = useCallback(
    (id: string) => {
      const ok = send({ type: "session.close", sessionId: id });
      if (!ok) {
        toast.error("删除失败，连接可能已断开");
        return;
      }
      removeSession(id);
    },
    [removeSession, send],
  );

  const handleCloseSessions = useCallback(
    (ids: string[]) => {
      const uniqueIds = [...new Set(ids)].filter(Boolean);
      if (uniqueIds.length === 0) return;

      const sentIds: string[] = [];
      uniqueIds.forEach((id) => {
        const ok = send({ type: "session.close", sessionId: id });
        if (ok) {
          sentIds.push(id);
          serverKnownRef.current.delete(id);
        }
      });
      if (sentIds.length > 0) {
        clearAllSessions(sentIds);
      }
      if (sentIds.length < uniqueIds.length) {
        toast.error(`有 ${uniqueIds.length - sentIds.length} 个会话删除请求发送失败`);
      }
    },
    [clearAllSessions, send],
  );

  const handleRefreshSessions = useCallback(() => {
    if (status !== "open") return;
    send({ type: "session.list" });
    send({ type: "model.list" });
    send({ type: "profile.get" });
  }, [status, send]);

  const handleRenameSession = useCallback(
    (id: string, title: string) => {
      const nextTitle = title.trim();
      if (!nextTitle) return;
      renameSession(id, nextTitle);
      send({ type: "session.rename", sessionId: id, title: nextTitle });
    },
    [renameSession, send],
  );

  const handleUpdateUserProfile = useCallback(
    (profile: { name: string; avatarDataUrl: string | null }) => {
      setUserProfile(profile);
      if (status === "open") {
        send({ type: "profile.update", profile });
      }
    },
    [send, setUserProfile, status],
  );

  const handleCancel = useCallback(() => {
    if (!activeId) return;
    if (status !== "open") return;
    send({ type: "session.cancel", sessionId: activeId });
    toast("已发送中断请求…");
  }, [activeId, status, send]);

  const sendAfterTruncate = useCallback(
    (pending: PendingAfterTruncate): boolean => {
      pendingAfterTruncateRef.current = [
        ...pendingAfterTruncateRef.current.filter(
          (item) => item.sessionId !== pending.sessionId || item.requestId !== pending.requestId,
        ),
        pending,
      ];

      const ok = send({
        type: "session.truncate_from",
        sessionId: pending.sessionId,
        requestId: pending.requestId,
      });
      if (!ok) {
        pendingAfterTruncateRef.current = pendingAfterTruncateRef.current.filter(
          (item) => item.sessionId !== pending.sessionId || item.requestId !== pending.requestId,
        );
        toast.error("操作失败，连接可能已断开");
      }
      return ok;
    },
    [send],
  );

  /** 重新回答：截断该轮及之后的历史，再以新 requestId 重新提交同一 user 消息。 */
  const handleRegenerate = useCallback(
    (message: ChatMessage) => {
      if (!activeId || status !== "open") return;
      const state = useStore.getState();
      const session = state.sessions[activeId];
      if (!session || !message.requestId) {
        toast.error("无法重新回答：缺少 requestId");
        return;
      }
      const userMsg = session.messages.find(
        (m) => m.requestId === message.requestId && m.role === "user",
      );
      if (!userMsg) {
        toast.error("找不到对应的用户消息");
        return;
      }
      sendAfterTruncate({
        sessionId: activeId,
        requestId: message.requestId,
        nextInput: userMsg.content,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
    },
    [activeId, sendAfterTruncate, status],
  );

  const handleEditUserMessage = useCallback(
    (message: ChatMessage, nextContent: string) => {
      if (!activeId || status !== "open") return;
      if (!message.requestId) {
        toast.error("无法编辑：缺少 requestId");
        return;
      }
      const trimmed = nextContent.trim();
      if (!trimmed) {
        toast.error("内容不能为空");
        return;
      }

      sendAfterTruncate({
        sessionId: activeId,
        requestId: message.requestId,
        nextInput: trimmed,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
    },
    [activeId, sendAfterTruncate, status],
  );

  const handleDeleteFromMessage = useCallback(
    (message: ChatMessage) => {
      if (!activeId || status !== "open") return;
      if (!message.requestId) {
        toast.error("无法删除：缺少 requestId");
        return;
      }
      const ok = send({
        type: "session.truncate_from",
        sessionId: activeId,
        requestId: message.requestId,
      });
      if (!ok) {
        toast.error("删除失败，连接可能已断开");
        return;
      }
      toast.success("已删除");
    },
    [activeId, status, send],
  );

  /** 查看对应消息所在 turn 的工作流——在右栏切到该 run */
  const setViewedRun = useStore((s) => s.setViewedRun);
  const handleViewWorkflow = useCallback(
    (message: ChatMessage) => {
      if (!activeId || !message.requestId) {
        toast.error("无法定位该消息的工作流");
        return;
      }
      const state = useStore.getState();
      const session = state.sessions[activeId];
      const run = session?.runs.find((r) => r.requestId === message.requestId);
      if (!run) {
        toast.info("该轮工作流仅在当前 session 期间可见", {
          description: "刷新后历史消息的思考过程不再保留——只有原始对话条目可恢复。",
        });
        return;
      }
      setViewedRun(activeId, run.requestId);
      if (!hasPersistentWorkflowPanel) {
        setWorkflowDrawerOpen(true);
        return;
      }
      // 顺便如果右栏是折叠的，展开它
      if (state.rightPanelCollapsed) {
        state.toggleRightPanel();
      }
    },
    [activeId, hasPersistentWorkflowPanel, setViewedRun],
  );

  const handleSend = useCallback(
    (input: string) => {
      const state = useStore.getState();
      const modelProviderId = state.selectedModelProviderId ?? undefined;
      let targetSessionId = activeId;

      if (targetSessionId && state.historyLoadingIds[targetSessionId]) {
        toast.warning("正在恢复历史，请稍后再发送");
        return;
      }

      if (!targetSessionId || state.missingOnServerIds[targetSessionId]) {
        if (targetSessionId) {
          serverKnownRef.current.delete(targetSessionId);
        }
        targetSessionId = generateId();
        const ok = send({ type: "session.create", sessionId: targetSessionId });
        if (!ok) {
          toast.error("创建会话失败，连接可能已断开");
          return;
        }
        registerSession(targetSessionId);
        serverKnownRef.current.add(targetSessionId);
      }

      const requestId = generateId();
      // 保证后端认识这个 sessionId（幂等）
      if (!serverKnownRef.current.has(targetSessionId)) {
        const ok = send({ type: "session.create", sessionId: targetSessionId });
        if (!ok) {
          toast.error("创建会话失败，连接可能已断开");
          return;
        }
        serverKnownRef.current.add(targetSessionId);
      }
      // 写入前端
      appendUserMessage(targetSessionId, requestId, input);
      // 记下来，万一 session.not_found 可重放
      lastSendRef.current = { sessionId: targetSessionId, requestId, input, modelProviderId };
      const ok = send({
        type: "session.message",
        sessionId: targetSessionId,
        requestId,
        modelProviderId,
        input,
      });
      if (!ok) {
        toast.error("发送失败，连接可能已断开");
      }
    },
    [activeId, appendUserMessage, registerSession, send],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell
        sessionRail={
          <SessionList
            presentation="rail"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={handleRefreshSessions}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
            onOpenSessionPanel={handleOpenSessionPanel}
          />
        }
        sessionPanel={
          <SessionList
            presentation="auto"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={handleRefreshSessions}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
          />
        }
        sessionDrawer={
          <SessionList
            presentation="panel"
            onNewSession={handleNewSession}
            onCloseSession={handleCloseSession}
            onCloseSessions={handleCloseSessions}
            onRefreshSessions={handleRefreshSessions}
            onRenameSession={handleRenameSession}
            userProfile={userProfile}
            onUpdateUserProfile={handleUpdateUserProfile}
            socketStatus={status}
            onSessionSelected={() => setSessionDrawerOpen(false)}
          />
        }
        chatPanel={
          <ChatPanel
            userProfile={userProfile}
            modelProviders={modelProviders}
            selectedModelProviderId={selectedModelProviderId}
            onSelectModelProvider={selectModelProvider}
            socketStatus={status}
            onSend={handleSend}
            onCancel={handleCancel}
            onRegenerate={handleRegenerate}
            onEditUserMessage={handleEditUserMessage}
            onDeleteFromMessage={handleDeleteFromMessage}
            onViewWorkflow={handleViewWorkflow}
            onOpenSessionPanel={handleOpenSessionPanel}
            onOpenWorkflowPanel={() => setWorkflowDrawerOpen(true)}
            onRetryHistory={requestSessionHistory}
          />
        }
        workflowPanel={<ThinkingTimeline presentation="auto" />}
        workflowDrawer={<ThinkingTimeline presentation="panel" hidePanelTitle />}
        sessionDrawerOpen={sessionDrawerOpen}
        onSessionDrawerOpenChange={setSessionDrawerOpen}
        workflowDrawerOpen={workflowDrawerOpen}
        onWorkflowDrawerOpenChange={setWorkflowDrawerOpen}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className:
            "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
