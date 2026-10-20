import { z } from "zod";
import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import type { SessionRuntimeSnapshot, StoreState } from "./types";
import { normalizeUserProfile, USER_PROFILE_SYNC_STATES } from "./userProfile";
import { clampWorkflowDockWidth } from "../../shared/responsive/workflowDock";
import { ExecutionApprovalModes } from "../../api/executionApprovalMode";
import { ModelThinkingLevels } from "../../features/chat/modelThinking";

export const PERSIST_KEY = "senera-frontend@v1";
const GlobalPreferencesSchema = z.object({
  defaultSidebarCollapsed: z.boolean().optional(),
  defaultRightPanelCollapsed: z.boolean().optional(),
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
  workflowDockWidth: z
    .number()
    .finite()
    .transform((value) => clampWorkflowDockWidth(value))
    .optional(),
});
export type PersistedSessionState = z.infer<typeof GlobalPreferencesSchema>;

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

export function readWorkspacePreferences(raw: string | null): Partial<WorkspacePreferences> {
  return raw === null ? {} : WorkspacePreferencesSchema.parse(JSON.parse(raw));
}

export const sessionPersistOptions: PersistOptions<StoreState, PersistedSessionState> = {
  name: PERSIST_KEY,
  version: 13,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => GlobalPreferencesSchema.parse(state),
  migrate: (persisted) => GlobalPreferencesSchema.parse(persisted),
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
      workflowDockWidth: preferences.workflowDockWidth ?? current.workflowDockWidth,
      userProfile: normalizeUserProfile(preferences.userProfile ?? current.userProfile),
    };
  },
};

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
  localStorage.removeItem(PERSIST_KEY);
}
