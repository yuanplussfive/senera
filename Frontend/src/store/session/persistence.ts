import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import type { StoreState } from "./types";
import { normalizeUserProfile } from "./userProfile";
import type { MotionLevel } from "../../shared/motion/types";
import { clampWorkflowDockWidth, DEFAULT_WORKFLOW_DOCK_WIDTH } from "../../shared/responsive/workflowDock";
import {
  ExecutionApprovalModes,
  isExecutionApprovalMode,
  type ExecutionApprovalMode,
} from "../../api/executionApprovalMode";

export const PERSIST_KEY = "senera-frontend@v1";

export type PersistedSessionState = Partial<
  Pick<
    StoreState,
    | "defaultSidebarCollapsed"
    | "defaultRightPanelCollapsed"
    | "sessionOrder"
    | "motionLevel"
    | "executionApprovalMode"
    | "selectedModelProviderId"
    | "selectedModelProviderIdsBySession"
    | "userProfile"
    | "workflowDockWidth"
  >
>;

export const sessionPersistOptions: PersistOptions<StoreState, PersistedSessionState> = {
  name: PERSIST_KEY,
  version: 8,
  storage: createJSONStorage(() => localStorage),
  // 后端是会话内容的 SSOT；前端另外缓存侧栏排序等 UI 偏好。
  // messages 不持久化 —— 后端 session.history 会权威回放。
  partialize: (state) => ({
    defaultSidebarCollapsed: state.defaultSidebarCollapsed,
    defaultRightPanelCollapsed: state.defaultRightPanelCollapsed,
    sessionOrder: state.sessionOrder,
    motionLevel: state.motionLevel,
    executionApprovalMode: state.executionApprovalMode,
    selectedModelProviderId: state.selectedModelProviderId,
    selectedModelProviderIdsBySession: state.selectedModelProviderIdsBySession,
    userProfile: state.userProfile,
    workflowDockWidth: state.workflowDockWidth,
  }),
  // 旧版本 localStorage 干净迁移
  migrate: (persisted: unknown, fromVersion: number) => {
    if (!persisted || typeof persisted !== "object") return {};
    const p = persisted as Partial<StoreState> & Record<string, unknown>;
    const motionLevel = fromVersion < 4 ? "full" : readPersistedMotionLevel(p.motionLevel);
    const sessionOrder = readPersistedSessionOrder(p.sessionOrder);
    return {
      defaultSidebarCollapsed: readPersistedBoolean(p.defaultSidebarCollapsed, false),
      defaultRightPanelCollapsed: readPersistedBoolean(p.defaultRightPanelCollapsed, true),
      ...(sessionOrder.length > 0 ? { sessionOrder } : {}),
      motionLevel,
      executionApprovalMode: readPersistedExecutionApprovalMode(p.executionApprovalMode),
      selectedModelProviderId: p.selectedModelProviderId,
      selectedModelProviderIdsBySession: readPersistedModelSelectionBySession(p.selectedModelProviderIdsBySession),
      userProfile: p.userProfile,
      workflowDockWidth: readPersistedWorkflowDockWidth(p.workflowDockWidth),
    };
  },
  // 即便 migrate 漏掉字段，merge 兜底
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<StoreState>;
    const defaultSidebarCollapsed = p.defaultSidebarCollapsed ?? false;
    const defaultRightPanelCollapsed = p.defaultRightPanelCollapsed ?? true;
    const sessionOrder = readPersistedSessionOrder(p.sessionOrder);
    return {
      ...current,
      sidebarCollapsed: defaultSidebarCollapsed,
      rightPanelCollapsed: defaultRightPanelCollapsed,
      defaultSidebarCollapsed,
      defaultRightPanelCollapsed,
      sessionOrder,
      motionLevel: readPersistedMotionLevel(p.motionLevel),
      executionApprovalMode: readPersistedExecutionApprovalMode(p.executionApprovalMode),
      selectedModelProviderId: p.selectedModelProviderId ?? null,
      selectedModelProviderIdsBySession: readPersistedModelSelectionBySession(p.selectedModelProviderIdsBySession),
      userProfile: normalizeUserProfile(p.userProfile),
      workflowDockWidth: readPersistedWorkflowDockWidth(p.workflowDockWidth),
      modelProviders: [],
      providerModelCatalogs: {},
      providerModelErrors: {},
      sessions: {},
      activeSessionId: null,
      viewedRunIdBySession: {},
      // 这两个是运行时态，rehydrate 一律重置
      historyLoadedIds: {},
      historyLoadingIds: {},
      historyFailedIds: {},
      historyReplayBuffers: {},
      historyStepBuffers: {},
      historyEventRunIds: {},
      historyActiveRequestIds: {},
      processedEventIds: {},
      processedEventIdOrder: [],
      missingOnServerIds: {},
      pendingCreatedSessionIds: {},
      pendingDeletedSessionIds: {},
      childSessionParentIds: {},
    };
  },
};

function readPersistedModelSelectionBySession(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1]),
    ),
  );
}

function readPersistedMotionLevel(value: unknown): MotionLevel {
  return value === "reduced" || value === "none" || value === "full" ? value : "full";
}

function readPersistedExecutionApprovalMode(value: unknown): ExecutionApprovalMode {
  return isExecutionApprovalMode(value) ? value : ExecutionApprovalModes.Agent;
}

function readPersistedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readPersistedSessionOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
}

function readPersistedWorkflowDockWidth(value: unknown): number {
  return clampWorkflowDockWidth(typeof value === "number" ? value : DEFAULT_WORKFLOW_DOCK_WIDTH);
}

export function readPersistedSessionPreferences(rawValue: string | null): PersistedSessionState | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as { state?: unknown };
    if (!parsed.state || typeof parsed.state !== "object") return null;
    const state = parsed.state as Partial<StoreState>;
    const sessionOrder = readPersistedSessionOrder(state.sessionOrder);
    return {
      defaultSidebarCollapsed:
        typeof state.defaultSidebarCollapsed === "boolean" ? state.defaultSidebarCollapsed : undefined,
      defaultRightPanelCollapsed:
        typeof state.defaultRightPanelCollapsed === "boolean" ? state.defaultRightPanelCollapsed : undefined,
      ...(sessionOrder.length > 0 ? { sessionOrder } : {}),
      motionLevel: readPersistedMotionLevel(state.motionLevel),
      executionApprovalMode: readPersistedExecutionApprovalMode(state.executionApprovalMode),
      selectedModelProviderId:
        typeof state.selectedModelProviderId === "string" ? state.selectedModelProviderId : undefined,
      selectedModelProviderIdsBySession: readPersistedModelSelectionBySession(state.selectedModelProviderIdsBySession),
      userProfile: state.userProfile,
      workflowDockWidth:
        typeof state.workflowDockWidth === "number"
          ? readPersistedWorkflowDockWidth(state.workflowDockWidth)
          : undefined,
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
