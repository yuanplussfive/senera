import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import type { StoreState } from "./types";
import { normalizeUserProfile } from "./userProfile";
import type { MotionLevel } from "../../shared/motion";

export const PERSIST_KEY = "senera-frontend@v1";

type PersistedSessionState = Partial<Pick<
  StoreState,
  | "defaultRightPanelCollapsed"
  | "defaultSidebarCollapsed"
  | "motionLevel"
  | "selectedModelProviderId"
  | "userProfile"
>>;

export const sessionPersistOptions: PersistOptions<StoreState, PersistedSessionState> = {
  name: PERSIST_KEY,
  version: 4,
  storage: createJSONStorage(() => localStorage),
  // 后端是 SSOT；前端只缓存 UI 偏好 + 会话元数据（标题/时间）。
  // messages 不持久化 —— 后端 session.history 会权威回放。
  partialize: (state) => ({
    defaultSidebarCollapsed: state.defaultSidebarCollapsed,
    defaultRightPanelCollapsed: state.defaultRightPanelCollapsed,
    motionLevel: state.motionLevel,
    selectedModelProviderId: state.selectedModelProviderId,
    userProfile: state.userProfile,
  }),
  // 旧版本 localStorage 干净迁移
  migrate: (persisted: unknown, fromVersion: number) => {
    if (!persisted || typeof persisted !== "object") return {};
    const p = persisted as Partial<StoreState> & Record<string, unknown>;
    const motionLevel = fromVersion < 4 ? "full" : readPersistedMotionLevel(p.motionLevel);
    return {
      defaultSidebarCollapsed: readPersistedBoolean(p.defaultSidebarCollapsed, false),
      defaultRightPanelCollapsed: readPersistedBoolean(p.defaultRightPanelCollapsed, false),
      motionLevel,
      selectedModelProviderId: p.selectedModelProviderId,
      userProfile: p.userProfile,
    };
  },
  // 即便 migrate 漏掉字段，merge 兜底
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<StoreState>;
    const defaultSidebarCollapsed = p.defaultSidebarCollapsed ?? false;
    const defaultRightPanelCollapsed = p.defaultRightPanelCollapsed ?? false;
    return {
      ...current,
      sidebarCollapsed: defaultSidebarCollapsed,
      rightPanelCollapsed: defaultRightPanelCollapsed,
      defaultSidebarCollapsed,
      defaultRightPanelCollapsed,
      motionLevel: readPersistedMotionLevel(p.motionLevel),
      selectedModelProviderId: p.selectedModelProviderId ?? null,
      userProfile: normalizeUserProfile(p.userProfile),
      modelProviders: [],
      providerModelCatalogs: {},
      providerModelErrors: {},
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

function readPersistedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readPersistedSessionPreferences(rawValue: string | null): PersistedSessionState | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as { state?: unknown };
    if (!parsed.state || typeof parsed.state !== "object") return null;
    const state = parsed.state as Partial<StoreState>;
    return {
      defaultSidebarCollapsed: typeof state.defaultSidebarCollapsed === "boolean"
        ? state.defaultSidebarCollapsed
        : undefined,
      defaultRightPanelCollapsed: typeof state.defaultRightPanelCollapsed === "boolean"
        ? state.defaultRightPanelCollapsed
        : undefined,
      motionLevel: readPersistedMotionLevel(state.motionLevel),
      selectedModelProviderId: typeof state.selectedModelProviderId === "string" ? state.selectedModelProviderId : undefined,
      userProfile: state.userProfile,
    };
  } catch {
    return null;
  }
}

export function clearPersistedStore(): void {
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}
