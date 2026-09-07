import type { ExecutionApprovalMode } from "../../api/executionApprovalMode";
import type { MotionLevel } from "../../shared/motion/types";
import { PERSIST_KEY, readPersistedSessionPreferences } from "./persistence";

interface SessionPreferenceState {
  readonly defaultSidebarCollapsed: boolean;
  readonly defaultRightPanelCollapsed: boolean;
  readonly sessionOrder: string[];
  readonly sidebarCollapsed: boolean;
  readonly rightPanelCollapsed: boolean;
  readonly motionLevel: MotionLevel;
  readonly executionApprovalMode: ExecutionApprovalMode;
  readonly workflowDockWidth: number;
  readonly selectedModelProviderId: string | null;
  readonly selectedModelProviderIdsBySession: Record<string, string>;
}

interface SessionPreferenceSyncPort {
  readonly read: () => SessionPreferenceState;
  readonly update: (state: Partial<SessionPreferenceState>) => void;
}

export function installSessionPreferenceSynchronization(port: SessionPreferenceSyncPort): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== PERSIST_KEY) return;
    const preferences = readPersistedSessionPreferences(event.newValue);
    if (!preferences) return;
    const state = port.read();
    const nextDefaultSidebarCollapsed = preferences.defaultSidebarCollapsed ?? state.defaultSidebarCollapsed;
    const nextDefaultRightPanelCollapsed = preferences.defaultRightPanelCollapsed ?? state.defaultRightPanelCollapsed;
    const nextSessionOrder = preferences.sessionOrder ?? state.sessionOrder;
    const nextMotionLevel = preferences.motionLevel ?? state.motionLevel;
    const nextExecutionApprovalMode = preferences.executionApprovalMode ?? state.executionApprovalMode;
    const nextWorkflowDockWidth = preferences.workflowDockWidth ?? state.workflowDockWidth;
    const nextSelectedModelProviderId = preferences.selectedModelProviderId ?? state.selectedModelProviderId;
    const nextSelectedModelProviderIdsBySession =
      preferences.selectedModelProviderIdsBySession ?? state.selectedModelProviderIdsBySession;
    const defaultSidebarChanged = nextDefaultSidebarCollapsed !== state.defaultSidebarCollapsed;
    const defaultRightPanelChanged = nextDefaultRightPanelCollapsed !== state.defaultRightPanelCollapsed;
    const sessionOrderChanged = !areStringArraysEqual(nextSessionOrder, state.sessionOrder);
    const motionLevelChanged = nextMotionLevel !== state.motionLevel;
    const executionApprovalModeChanged = nextExecutionApprovalMode !== state.executionApprovalMode;
    const workflowDockWidthChanged = nextWorkflowDockWidth !== state.workflowDockWidth;
    const selectedModelProviderChanged = nextSelectedModelProviderId !== state.selectedModelProviderId;
    const selectedModelsBySessionChanged = !areStringRecordsEqual(
      nextSelectedModelProviderIdsBySession,
      state.selectedModelProviderIdsBySession,
    );
    if (
      !defaultSidebarChanged &&
      !defaultRightPanelChanged &&
      !sessionOrderChanged &&
      !motionLevelChanged &&
      !executionApprovalModeChanged &&
      !workflowDockWidthChanged &&
      !selectedModelProviderChanged &&
      !selectedModelsBySessionChanged
    ) {
      return;
    }
    port.update({
      defaultSidebarCollapsed: nextDefaultSidebarCollapsed,
      defaultRightPanelCollapsed: nextDefaultRightPanelCollapsed,
      ...(sessionOrderChanged ? { sessionOrder: nextSessionOrder } : {}),
      ...(defaultSidebarChanged ? { sidebarCollapsed: nextDefaultSidebarCollapsed } : {}),
      ...(defaultRightPanelChanged ? { rightPanelCollapsed: nextDefaultRightPanelCollapsed } : {}),
      motionLevel: nextMotionLevel,
      executionApprovalMode: nextExecutionApprovalMode,
      workflowDockWidth: nextWorkflowDockWidth,
      selectedModelProviderId: nextSelectedModelProviderId,
      selectedModelProviderIdsBySession: nextSelectedModelProviderIdsBySession,
    });
  });
}

function areStringRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
