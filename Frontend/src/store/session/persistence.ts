import { z } from "zod";
import type { PersistOptions, PersistStorage, StorageValue } from "zustand/middleware";
import type { SessionRuntimeSnapshot, StoreState } from "./types";
import { normalizeUserProfile, USER_PROFILE_SYNC_STATES } from "./userProfile";
import { clampWorkflowDockWidthRatio } from "../../shared/responsive/workflowDock";
import { ExecutionApprovalModes } from "../../api/executionApprovalMode";
import { ModelThinkingLevels } from "../../features/chat/modelThinking";
import {
  clampTerminalPanelHeightRatio,
  DEFAULT_TERMINAL_PANEL_HEIGHT_RATIO,
} from "../../shared/responsive/terminalPanel";

export const PERSIST_KEY =
  window.location.pathname.startsWith("/mobile/") && window.__SENERA_RUNTIME_CONFIG__?.httpBaseUrl
    ? `senera-frontend@v1:${new URL(window.__SENERA_RUNTIME_CONFIG__.httpBaseUrl).origin}`
    : "senera-frontend@v1";
const GlobalPreferencesSchema = z.object({
  defaultSidebarCollapsed: z.boolean().optional(),
  defaultRightPanelCollapsed: z.boolean().optional(),
  terminalPanelOpen: z.boolean().optional(),
  terminalPanelMaximized: z.boolean().optional(),
  terminalPanelHeightRatio: z.number().finite().transform(clampTerminalPanelHeightRatio).optional(),
  motionLevel: z.enum(["full", "reduced", "none"]).optional(),
  executionApprovalMode: z.enum(Object.values(ExecutionApprovalModes)).optional(),
  userProfile: z
    .object({
      name: z.string(),
      avatarDataUrl: z.string().nullable(),
      avatarPath: z.string().nullable().optional(),
      assistant: z
        .object({
          name: z.string(),
          avatarDataUrl: z.string().nullable(),
          avatarPath: z.string().nullable().optional(),
        })
        .optional(),
      updatedAt: z.string(),
      syncState: z.enum(USER_PROFILE_SYNC_STATES).optional(),
    })
    .optional(),
  workflowDockWidthRatio: z.number().finite().transform(clampWorkflowDockWidthRatio).optional(),
});
export type PersistedSessionState = z.infer<typeof GlobalPreferencesSchema>;

interface PersistedPreferenceInputs {
  defaultSidebarCollapsed: StoreState["defaultSidebarCollapsed"];
  defaultRightPanelCollapsed: StoreState["defaultRightPanelCollapsed"];
  motionLevel: StoreState["motionLevel"];
  executionApprovalMode: StoreState["executionApprovalMode"];
  userProfile: StoreState["userProfile"];
  workflowDockWidthRatio: StoreState["workflowDockWidthRatio"];
  terminalPanelOpen: StoreState["terminalPanelOpen"];
  terminalPanelMaximized: StoreState["terminalPanelMaximized"];
  terminalPanelHeightRatio: StoreState["terminalPanelHeightRatio"];
}

let cachedPreferenceInputs: PersistedPreferenceInputs | undefined;
let cachedPreferences: PersistedSessionState | undefined;
const persistedPreferenceStates = new Map<string, PersistedSessionState>();

const WorkspacePreferencesSchema = z.object({
  activeSessionId: z.string().nullable().optional(),
  runtimeSnapshotsBySession: z
    .record(z.string(), z.custom<SessionRuntimeSnapshot>(isPersistedRuntimeSnapshot))
    .optional(),
  sessionOrder: z
    .array(z.string().min(1))
    .transform((ids) => [...new Set(ids)])
    .optional(),
  selectedModelProviderId: z.string().nullable().optional(),
  selectedModelProviderIdsBySession: z.record(z.string(), z.string().min(1)).optional(),
  selectedThinkingLevel: z.enum(ModelThinkingLevels).nullable().optional(),
  selectedThinkingLevelsBySession: z.record(z.string(), z.enum(ModelThinkingLevels)).optional(),
});
export type WorkspacePreferences = Pick<
  StoreState,
  | "activeSessionId"
  | "runtimeSnapshotsBySession"
  | "sessionOrder"
  | "selectedModelProviderId"
  | "selectedModelProviderIdsBySession"
  | "selectedThinkingLevel"
  | "selectedThinkingLevelsBySession"
>;

const preferenceStorage: PersistStorage<PersistedSessionState> = {
  getItem(name) {
    const raw = localStorage.getItem(name);
    if (raw === null) return null;
    const value = JSON.parse(raw) as StorageValue<PersistedSessionState>;
    persistedPreferenceStates.set(name, value.state);
    return value;
  },
  setItem(name, value) {
    // Persist middleware runs after every store mutation. Returning the same
    // preference snapshot for non-preference updates lets this boundary avoid
    // both serialization and synchronous localStorage writes during streams.
    if (persistedPreferenceStates.get(name) === value.state) return;
    localStorage.setItem(name, JSON.stringify(value));
    persistedPreferenceStates.set(name, value.state);
  },
  removeItem(name) {
    persistedPreferenceStates.delete(name);
    localStorage.removeItem(name);
  },
};

export function readWorkspacePreferences(raw: string | null): Partial<WorkspacePreferences> {
  return raw === null ? {} : WorkspacePreferencesSchema.parse(JSON.parse(raw));
}

export const sessionPersistOptions: PersistOptions<StoreState, PersistedSessionState> = {
  name: PERSIST_KEY,
  version: 16,
  storage: preferenceStorage,
  partialize: selectPersistedSessionPreferences,
  migrate: (persisted, version) => {
    const preferences = GlobalPreferencesSchema.parse(persisted);
    // Update the former default once; retain heights chosen by resizing.
    if (version < 15 && preferences.terminalPanelHeightRatio === 0.4) {
      preferences.terminalPanelHeightRatio = DEFAULT_TERMINAL_PANEL_HEIGHT_RATIO;
    }
    return preferences;
  },
  merge: (persisted, current) => {
    const preferences = GlobalPreferencesSchema.parse(persisted ?? {});
    return {
      ...current,
      sidebarCollapsed: preferences.defaultSidebarCollapsed ?? current.defaultSidebarCollapsed,
      rightPanelCollapsed: preferences.defaultRightPanelCollapsed ?? current.defaultRightPanelCollapsed,
      defaultSidebarCollapsed: preferences.defaultSidebarCollapsed ?? current.defaultSidebarCollapsed,
      defaultRightPanelCollapsed: preferences.defaultRightPanelCollapsed ?? current.defaultRightPanelCollapsed,
      motionLevel: preferences.motionLevel ?? current.motionLevel,
      executionApprovalMode: preferences.executionApprovalMode ?? current.executionApprovalMode,
      workflowDockWidthRatio: preferences.workflowDockWidthRatio ?? current.workflowDockWidthRatio,
      terminalPanelOpen: preferences.terminalPanelOpen ?? current.terminalPanelOpen,
      terminalPanelMaximized: preferences.terminalPanelMaximized ?? current.terminalPanelMaximized,
      terminalPanelHeightRatio: preferences.terminalPanelHeightRatio ?? current.terminalPanelHeightRatio,
      userProfile: normalizeUserProfile(preferences.userProfile ?? current.userProfile),
    };
  },
};

function selectPersistedSessionPreferences(state: StoreState): PersistedSessionState {
  const inputs: PersistedPreferenceInputs = {
    defaultSidebarCollapsed: state.defaultSidebarCollapsed,
    defaultRightPanelCollapsed: state.defaultRightPanelCollapsed,
    motionLevel: state.motionLevel,
    executionApprovalMode: state.executionApprovalMode,
    userProfile: state.userProfile,
    workflowDockWidthRatio: state.workflowDockWidthRatio,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalPanelMaximized: state.terminalPanelMaximized,
    terminalPanelHeightRatio: state.terminalPanelHeightRatio,
  };
  if (cachedPreferences && cachedPreferenceInputs && samePersistedPreferenceInputs(cachedPreferenceInputs, inputs)) {
    return cachedPreferences;
  }
  const preferences = GlobalPreferencesSchema.parse(inputs);
  cachedPreferenceInputs = inputs;
  cachedPreferences = preferences;
  return preferences;
}

function samePersistedPreferenceInputs(left: PersistedPreferenceInputs, right: PersistedPreferenceInputs): boolean {
  return (
    left.defaultSidebarCollapsed === right.defaultSidebarCollapsed &&
    left.defaultRightPanelCollapsed === right.defaultRightPanelCollapsed &&
    left.motionLevel === right.motionLevel &&
    left.executionApprovalMode === right.executionApprovalMode &&
    left.userProfile === right.userProfile &&
    left.workflowDockWidthRatio === right.workflowDockWidthRatio &&
    left.terminalPanelOpen === right.terminalPanelOpen &&
    left.terminalPanelMaximized === right.terminalPanelMaximized &&
    left.terminalPanelHeightRatio === right.terminalPanelHeightRatio
  );
}

function isPersistedRuntimeSnapshot(value: unknown): value is SessionRuntimeSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.available !== "boolean" || typeof snapshot.observedAt !== "string") return false;
  if (snapshot.runtime === undefined) return true;
  if (!snapshot.runtime || typeof snapshot.runtime !== "object" || Array.isArray(snapshot.runtime)) return false;

  const runtime = snapshot.runtime as Record<string, unknown>;
  const contextUsage = runtime.contextUsage;
  if (contextUsage === undefined) return true;
  if (!contextUsage || typeof contextUsage !== "object" || Array.isArray(contextUsage)) return false;
  const usage = contextUsage as Record<string, unknown>;
  return (
    typeof usage.contextWindow === "number" &&
    Number.isFinite(usage.contextWindow) &&
    (usage.tokens === null || (typeof usage.tokens === "number" && Number.isFinite(usage.tokens))) &&
    (usage.percent === null || (typeof usage.percent === "number" && Number.isFinite(usage.percent)))
  );
}

export function readPersistedSessionPreferences(raw: string | null): PersistedSessionState | null {
  if (raw === null) return null;
  try {
    const envelope = z.object({ state: GlobalPreferencesSchema }).parse(JSON.parse(raw));
    return envelope.state;
  } catch {
    // A malformed storage event is rejected; it cannot overwrite a valid live state.
    return null;
  }
}

export function clearPersistedStore(): void {
  preferenceStorage.removeItem(PERSIST_KEY);
}
