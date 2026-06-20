import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import type { StoreState } from "./types";
import { normalizeUserProfile } from "./userProfile";
import type { MotionLevel } from "../../shared/motion";

export const PERSIST_KEY = "senera-frontend@v1";

type PersistedSessionState = Partial<Pick<
  StoreState,
  "motionLevel" | "rightPanelCollapsed" | "selectedModelProviderId" | "sidebarCollapsed" | "userProfile"
>>;

export const sessionPersistOptions: PersistOptions<StoreState, PersistedSessionState> = {
  name: PERSIST_KEY,
  version: 4,
  storage: createJSONStorage(() => localStorage),
  // 后端是 SSOT；前端只缓存 UI 偏好 + 会话元数据（标题/时间）。
  // messages 不持久化 —— 后端 session.history 会权威回放。
  partialize: (state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    rightPanelCollapsed: state.rightPanelCollapsed,
    motionLevel: state.motionLevel,
    selectedModelProviderId: state.selectedModelProviderId,
    userProfile: state.userProfile,
  }),
  // 旧版本 localStorage 干净迁移
  migrate: (persisted: unknown, fromVersion: number) => {
    if (!persisted || typeof persisted !== "object") return {};
    const p = persisted as Partial<StoreState> & Record<string, unknown>;
    if (fromVersion < 2) {
      // v1 没有 viewedRunIdBySession / rightPanelCollapsed——补默认
      p.viewedRunIdBySession = (p.viewedRunIdBySession as Record<string, string>) ?? {};
      p.rightPanelCollapsed = (p.rightPanelCollapsed as boolean) ?? false;
    }
    if (fromVersion < 4) {
      p.motionLevel = "full";
    }
    return {
      sidebarCollapsed: p.sidebarCollapsed,
      rightPanelCollapsed: p.rightPanelCollapsed,
      motionLevel: readPersistedMotionLevel(p.motionLevel),
      selectedModelProviderId: p.selectedModelProviderId,
      userProfile: p.userProfile,
    };
  },
  // 即便 migrate 漏掉字段，merge 兜底
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<StoreState>;
    return {
      ...current,
      sidebarCollapsed: p.sidebarCollapsed ?? false,
      rightPanelCollapsed: p.rightPanelCollapsed ?? false,
      motionLevel: readPersistedMotionLevel(p.motionLevel),
      selectedModelProviderId: p.selectedModelProviderId ?? null,
      userProfile: normalizeUserProfile(p.userProfile),
      modelProviders: [],
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
      viewedRunIdBySession: {},
      // 这两个是运行时态，rehydrate 一律重置
      historyLoadedIds: {},
      historyLoadingIds: {},
      historyFailedIds: {},
      historyReplayBuffers: {},
      historyStepBuffers: {},
      historyEventRunIds: {},
      missingOnServerIds: {},
      pendingCreatedSessionIds: {},
      pendingDeletedSessionIds: {},
    };
  },
};

function readPersistedMotionLevel(value: unknown): MotionLevel {
  return value === "reduced" || value === "none" || value === "full" ? value : "full";
}

export function clearPersistedStore(): void {
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}
