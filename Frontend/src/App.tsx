import { useCallback, useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import { TooltipProvider } from "./components/ui/Tooltip";
import { useAgentSocket } from "./api/useAgentSocket";
import { useStore } from "./store/sessionStore";
import { SessionList } from "./components/SessionList";
import { ChatPanel } from "./components/ChatPanel";
import { ThinkingTimeline } from "./components/ThinkingTimeline";
import { EventKinds, type WsRequest } from "./api/eventTypes";
import { generateId } from "./lib/util";
import type { UserProfileData } from "./api/eventTypes";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8787";

export function App(): JSX.Element {
  const ingest = useStore((s) => s.ingest);
  const registerSession = useStore((s) => s.registerCreatingSession);
  const clearAllSessions = useStore((s) => s.clearAllSessions);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const renameSession = useStore((s) => s.renameSession);
  const activeId = useStore((s) => s.activeSessionId);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const markHistoryLoading = useStore((s) => s.markHistoryLoading);
  const modelProviders = useStore((s) => s.modelProviders);
  const selectedModelProviderId = useStore((s) => s.selectedModelProviderId);
  const selectModelProvider = useStore((s) => s.selectModelProvider);
  const userProfile = useStore((s) => s.userProfile);
  const setUserProfile = useStore((s) => s.setUserProfile);
  const markUserProfileSynced = useStore((s) => s.markUserProfileSynced);

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
  // 待办的"truncate 完后做点啥"队列——避免 setTimeout 魔法等待
  const pendingAfterTruncateRef = useRef<
    Array<{ sessionId: string; requestId: string; nextInput?: string; modelProviderId?: string }>
  >([]);

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
            const state = useStore.getState();
            if (!state.sessions[lost]) {
              return;
            }
            const serverSessions = state.sessionOrder.filter((id) => !state.missingOnServerIds[id]);
            const fallbackId = serverSessions[0] ?? null;
            if (fallbackId && state.activeSessionId === lost) {
              state.selectSession(fallbackId);
            }
            toast.warning("该本地会话在后端不存在", {
              description: "已切换到仍存在历史的会话。旧的本地占位不会再被自动恢复成空会话。",
            });
            return;
          }
          if (data.operation === "session.close") {
            useStore.getState().removeSession(lost);
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
          toast.error("运行失败", {
            description: (env.data as { message?: string }).message ?? "",
          });
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
            if (pending.nextInput) {
              const newRequestId = generateId();
              // 直接走 store + send；不依赖 React 闭包里的 handleSend
              useStore
                .getState()
                .appendUserMessage(pending.sessionId, newRequestId, pending.nextInput);
              sendRef.current({
                type: "session.message",
                sessionId: pending.sessionId,
                requestId: newRequestId,
                modelProviderId: pending.modelProviderId,
                input: pending.nextInput,
              });
            }
          }
        }

      },
      [ingest, markUserProfileSynced],
    ),
  });

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
      markHistoryLoading(activeId);
      send({ type: "session.history", sessionId: activeId });
    }
  }, [activeId, status, send, markHistoryLoading]);

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "n") {
        e.preventDefault();
        handleNewSession();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleNewSession = useCallback(() => {
    if (status !== "open") {
      toast.warning("后端未连接，无法新建会话");
      return;
    }
    const id = generateId();
    registerSession(id);
    send({ type: "session.create", sessionId: id });
    serverKnownRef.current.add(id);
  }, [status, send, registerSession]);

  const handleCloseSession = useCallback(
    (id: string) => {
      send({ type: "session.close", sessionId: id });
    },
    [send],
  );

  const handleCloseSessions = useCallback(
    (ids: string[]) => {
      const uniqueIds = [...new Set(ids)].filter(Boolean);
      if (uniqueIds.length === 0) return;

      clearAllSessions(uniqueIds);
      uniqueIds.forEach((id) => {
        serverKnownRef.current.delete(id);
        send({ type: "session.close", sessionId: id });
      });
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

  /** 重新回答：truncate 该轮的所有 entry，再以新 requestId 重新提交同一 user 消息。
   *  用 pendingAfterTruncateRef 队列等 SessionTruncated 事件抵达后才发——不用 setTimeout 魔法。 */
  const handleRegenerate = useCallback(
    (message: import("./store/sessionStore").ChatMessage) => {
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
      pendingAfterTruncateRef.current.push({
        sessionId: activeId,
        requestId: message.requestId,
        nextInput: userMsg.content,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
      send({
        type: "session.truncate_from",
        sessionId: activeId,
        requestId: message.requestId,
      });
    },
    [activeId, status, send],
  );

  const handleEditUserMessage = useCallback(
    (message: import("./store/sessionStore").ChatMessage, nextContent: string) => {
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

      // Strategy: truncate from this requestId, then re-send the edited content as a new requestId.
      // We do not try to "edit in place" on the server yet; server history is SSOT and currently
      // only supports truncate_from + append via session.message.
      pendingAfterTruncateRef.current.push({
        sessionId: activeId,
        requestId: message.requestId,
        nextInput: trimmed,
        modelProviderId: useStore.getState().selectedModelProviderId ?? undefined,
      });
      send({
        type: "session.truncate_from",
        sessionId: activeId,
        requestId: message.requestId,
      });
    },
    [activeId, status, send],
  );

  const handleDeleteFromMessage = useCallback(
    (message: import("./store/sessionStore").ChatMessage) => {
      if (!activeId || status !== "open") return;
      if (!message.requestId) {
        toast.error("无法删除：缺少 requestId");
        return;
      }
      if (!window.confirm("从此处开始删除？这一条及之后的所有消息将从后端永久移除。")) return;
      send({
        type: "session.truncate_from",
        sessionId: activeId,
        requestId: message.requestId,
      });
      toast.success("已删除");
    },
    [activeId, status, send],
  );

  /** 查看对应消息所在 turn 的工作流——在右栏切到该 run */
  const setViewedRun = useStore((s) => s.setViewedRun);
  const handleViewWorkflow = useCallback(
    (message: import("./store/sessionStore").ChatMessage) => {
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
      // 顺便如果右栏是折叠的，展开它
      if (state.rightPanelCollapsed) {
        state.toggleRightPanel();
      }
    },
    [activeId, setViewedRun],
  );

  const handleSend = useCallback(
    (input: string) => {
      const state = useStore.getState();
      const modelProviderId = state.selectedModelProviderId ?? undefined;
      let targetSessionId = activeId;

      if (!targetSessionId || state.missingOnServerIds[targetSessionId]) {
        if (targetSessionId) {
          serverKnownRef.current.delete(targetSessionId);
        }
        targetSessionId = generateId();
        registerSession(targetSessionId);
        send({ type: "session.create", sessionId: targetSessionId });
        serverKnownRef.current.add(targetSessionId);
      }

      const requestId = generateId();
      // 写入前端
      appendUserMessage(targetSessionId, requestId, input);
      // 保证后端认识这个 sessionId（幂等）
      if (!serverKnownRef.current.has(targetSessionId)) {
        send({ type: "session.create", sessionId: targetSessionId });
        serverKnownRef.current.add(targetSessionId);
      }
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
      <div className="relative flex h-screen w-screen overflow-hidden text-ink-900">
        <SessionList
          onNewSession={handleNewSession}
          onCloseSession={handleCloseSession}
          onCloseSessions={handleCloseSessions}
          onRefreshSessions={handleRefreshSessions}
          onRenameSession={handleRenameSession}
          userProfile={userProfile}
          onUpdateUserProfile={handleUpdateUserProfile}
          socketStatus={status}
        />
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
        />
        <ThinkingTimeline />
      </div>
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
