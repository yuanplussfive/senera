import { useStore, type ChatMessage, type RunRecord, type SessionRecord } from "../store/sessionStore";

type DevSeedOptions = {
  sessions?: number;
  messages?: number;
};

type PerfSample = {
  label: string;
  durationMs: number;
  longTasks: number;
  maxLongTaskMs: number;
};

export interface SeneraMotionDevTools {
  seed(options?: DevSeedOptions): void;
  addMessages(count?: number): Promise<PerfSample>;
  measureInsertion(count?: number): Promise<PerfSample>;
  measureScroll(): Promise<PerfSample>;
  clearMeasures(): void;
}

declare global {
  interface Window {
    __seneraMotionDev?: SeneraMotionDevTools;
  }

  var __seneraMotionDev: SeneraMotionDevTools | undefined;
}

const MOCK_SESSION_PREFIX = "dev-motion-session";
let cleanupMotionDevTools: (() => void) | undefined;

export function installMotionDevTools(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  document.documentElement.dataset.motionDevTools = "ready";
  cleanupMotionDevTools?.();
  const tools: SeneraMotionDevTools = {
    seed(options) {
      const sessionCount = clampCount(options?.sessions ?? 30, 1, 120);
      const messageCount = clampCount(options?.messages ?? 100, 1, 600);
      const sessions = generateMockSessions(sessionCount, messageCount);
      useStore.getState().replaceWithDevMockData(sessions, sessions[0]?.sessionId);
    },
    async addMessages(count = 1) {
      return measureMessageInsertion(count, "dev-add-messages");
    },
    async measureInsertion(count = 10) {
      return measureMessageInsertion(count, "dev-measure-insertion");
    },
    async measureScroll() {
      return measureScrollPerformance();
    },
    clearMeasures() {
      performance.clearMarks();
      performance.clearMeasures();
    },
  };
  window.__seneraMotionDev = tools;
  globalThis.__seneraMotionDev = tools;
  document.documentElement.dataset.motionDevTools = "installed";

  const handleKeydown = (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "m") {
      event.preventDefault();
      tools.seed();
    }
    if (key === "a") {
      event.preventDefault();
      void tools.addMessages(10).then(writeLastMeasure);
    }
    if (key === "s") {
      event.preventDefault();
      void tools.measureScroll().then(writeLastMeasure);
    }
  };
  window.addEventListener("keydown", handleKeydown);
  cleanupMotionDevTools = () => window.removeEventListener("keydown", handleKeydown);

  runUrlCommand(tools);
}

function runUrlCommand(tools: SeneraMotionDevTools): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("motionMock") && !params.has("motionMeasure") && !params.has("motionMeasureScroll")) return;

  const sessions = parseCount(params.get("sessions"), 30);
  const messages = parseCount(params.get("messages"), 100);
  tools.seed({ sessions, messages });

  if (params.has("motionMeasure")) {
    const count = parseCount(params.get("motionMeasure"), 10);
    document.documentElement.dataset.motionDevLastMeasureStatus = "pending";
    window.setTimeout(() => {
      void tools.measureInsertion(count).then(writeLastMeasure).catch(writeLastMeasureError);
    }, 0);
  }
  if (params.has("motionMeasureScroll")) {
    document.documentElement.dataset.motionDevLastMeasureStatus = "pending";
    window.setTimeout(() => {
      void tools.measureScroll().then(writeLastMeasure).catch(writeLastMeasureError);
    }, 0);
  }
}

function writeLastMeasure(sample: PerfSample): void {
  document.documentElement.dataset.motionDevLastMeasureStatus = "done";
  document.documentElement.dataset.motionDevLastMeasure = JSON.stringify(sample);
}

function writeLastMeasureError(error: unknown): void {
  document.documentElement.dataset.motionDevLastMeasureStatus = "error";
  document.documentElement.dataset.motionDevLastMeasureError =
    error instanceof Error ? error.message : String(error);
}

function generateMockSessions(sessionCount: number, messageCount: number): SessionRecord[] {
  const now = Date.now();
  return Array.from({ length: sessionCount }, (_, index) => {
    const sessionId = `${MOCK_SESSION_PREFIX}-${index + 1}`;
    const messages = index === 0 ? generateMockMessages(messageCount, sessionId, now) : [];
    const runs = index === 0 ? generateMockRuns(messages, now) : [];
    return {
      sessionId,
      title: index === 0 ? "Motion 性能样本" : `历史会话 ${index + 1}`,
      status: "ready",
      createdAt: new Date(now - (index + 1) * 86_400_000).toISOString(),
      updatedAt: new Date(now - index * 600_000).toISOString(),
      entryCount: messages.length,
      messageCount: messages.length,
      messages,
      runs,
    };
  });
}

function generateMockMessages(count: number, sessionId: string, now: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const requestIndex = Math.floor(index / 2);
    const requestId = `${sessionId}-req-${requestIndex + 1}`;
    const isUser = index % 2 === 0;
    return {
      id: `${requestId}-${isUser ? "user" : "answer"}`,
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `帮我检查第 ${requestIndex + 1} 个前端交互路径。`
        : `已完成第 ${requestIndex + 1} 轮检查：列表、消息和抽屉动画保持轻量，长列表不会启用 layout 动画。`,
      createdAt: new Date(now - (count - index) * 18_000).toISOString(),
      kind: isUser ? undefined : "FinalAnswer",
      requestId,
    };
  });
}

function generateMockRuns(messages: ChatMessage[], now: number): RunRecord[] {
  const userMessages = messages.filter((message) => message.role === "user" && message.requestId);
  return userMessages.map((message, index) => {
    const startedAt = message.createdAt;
    const endedAt = new Date(new Date(startedAt).getTime() + 1400).toISOString();
    return {
      requestId: message.requestId ?? `dev-run-${index + 1}`,
      revision: 3,
      startedAt,
      endedAt,
      status: "completed",
      input: message.content,
      steps: [
        {
          id: `${message.requestId}-understand`,
          kind: "understand",
          title: "理解用户问题",
          status: "done",
          startedAt,
          endedAt: new Date(new Date(startedAt).getTime() + 120).toISOString(),
        },
        {
          id: `${message.requestId}-model`,
          kind: "model",
          title: "模型生成",
          status: "done",
          startedAt: new Date(new Date(startedAt).getTime() + 120).toISOString(),
          endedAt,
          modelName: "dev-model",
        },
        {
          id: `${message.requestId}-answer`,
          kind: "answer",
          title: "生成回复",
          status: "done",
          startedAt: endedAt,
          endedAt,
        },
      ],
      streamingRaw: "",
      xmlPreview: "",
      visibleText: "",
      displayText: "",
      visibleKind: "final_answer",
      expectedOutputMode: "final_text",
      decisionMode: "none",
      pendingToolArgsByName: {},
      modelProvider: {
        id: "dev-model",
        title: "Dev Model",
        kind: "dev",
        endpoint: "dev://motion",
        baseUrl: "dev://motion",
        model: "dev-model",
      },
    } satisfies RunRecord;
  }).filter((run) => new Date(run.startedAt).getTime() <= now);
}

async function measureMessageInsertion(count: number, label: string): Promise<PerfSample> {
  const safeCount = clampCount(count, 1, 100);
  const state = useStore.getState();
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    const sessions = generateMockSessions(1, 2);
    state.replaceWithDevMockData(sessions, sessions[0]?.sessionId);
  }
  const targetSessionId = useStore.getState().activeSessionId;
  if (!targetSessionId) throw new Error("No active session available for dev insertion.");

  const start = performance.now();
  const observer = createLongTaskObserver(start);
  for (let index = 0; index < safeCount; index += 1) {
    useStore.getState().appendUserMessage(
      targetSessionId,
      `dev-insert-${Date.now()}-${index}`,
      `Motion 插入性能样本 ${index + 1}`,
    );
  }
  await waitForNextPaint();
  const durationMs = performance.now() - start;
  observer.disconnect();
  return {
    label,
    durationMs: Number(durationMs.toFixed(2)),
    longTasks: observer.entries.length,
    maxLongTaskMs: Number(Math.max(0, ...observer.entries.map((entry) => entry.duration)).toFixed(2)),
  };
}

async function measureScrollPerformance(): Promise<PerfSample> {
  const state = useStore.getState();
  const sessionId = state.activeSessionId;
  if (!sessionId) {
    const sessions = generateMockSessions(30, 100);
    state.replaceWithDevMockData(sessions, sessions[0]?.sessionId);
  }

  await waitForNextPaint();

  const chatContainer = document.querySelector('[data-chat-container]');
  if (!chatContainer) {
    throw new Error("Chat container not found. Ensure [data-chat-container] exists in the DOM.");
  }

  const start = performance.now();
  const observer = createLongTaskObserver(start);

  // 滚动到顶部
  chatContainer.scrollTop = 0;
  await waitForNextPaint();

  // 滚动到底部
  chatContainer.scrollTop = chatContainer.scrollHeight;
  await waitForNextPaint();

  // 再次滚动到中间位置测试平滑滚动
  chatContainer.scrollTop = chatContainer.scrollHeight / 2;
  await waitForNextPaint();

  const durationMs = performance.now() - start;
  observer.disconnect();

  return {
    label: "scroll-performance",
    durationMs: Number(durationMs.toFixed(2)),
    longTasks: observer.entries.length,
    maxLongTaskMs: Number(Math.max(0, ...observer.entries.map((entry) => entry.duration)).toFixed(2)),
  };
}

function createLongTaskObserver(startTime: number): {
  entries: PerformanceEntry[];
  disconnect: () => void;
} {
  const entries: PerformanceEntry[] = [];
  if (typeof PerformanceObserver === "undefined") {
    return { entries, disconnect: () => undefined };
  }
  try {
    const observer = new PerformanceObserver((list) => {
      entries.push(...list.getEntries().filter((entry) => entry.startTime >= startTime));
    });
    observer.observe({ type: "longtask" });
    return { entries, disconnect: () => observer.disconnect() };
  } catch {
    return { entries, disconnect: () => undefined };
  }
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, 160);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.clearTimeout(timeoutId);
        resolve();
      });
    });
  });
}

function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseCount(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  return Number(value);
}
