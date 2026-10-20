import { describe, expect, it } from "vitest";
import {
  readPersistedSessionPreferences,
  readWorkspacePreferences,
  sessionPersistOptions,
} from "../../../Frontend/src/store/session/persistence.ts";
import { DEFAULT_USER_PROFILE } from "../../../Frontend/src/store/session/userProfile.ts";

describe("application and workspace persistence", () => {
  it("retains application preferences without assigning legacy sessions to any workspace", () => {
    const migrated = sessionPersistOptions.migrate(
      {
        defaultSidebarCollapsed: true,
        defaultRightPanelCollapsed: false,
        motionLevel: "reduced",
        workflowDockWidth: 555,
        userProfile: DEFAULT_USER_PROFILE,
        activeSessionId: "old-session",
        selectedModelProviderId: "old-model",
        sessions: { "old-session": {} },
        sessionOrder: ["old-session"],
        runtimeSnapshotsBySession: { "old-session": { available: true, observedAt: "2026-10-10" } },
      },
      10,
    );
    expect(migrated).toEqual({
      defaultSidebarCollapsed: true,
      defaultRightPanelCollapsed: false,
      motionLevel: "reduced",
      workflowDockWidth: 555,
      userProfile: DEFAULT_USER_PROFILE,
    });
  });

  it("applies launch preferences while preserving current workspace data during global rehydration", () => {
    const current = {
      defaultSidebarCollapsed: false,
      defaultRightPanelCollapsed: true,
      motionLevel: "full",
      userProfile: DEFAULT_USER_PROFILE,
      workflowDockWidth: 420,
      activeSessionId: "workspace-session",
      sessions: { "workspace-session": {} },
    };
    const merged = sessionPersistOptions.merge(
      {
        defaultRightPanelCollapsed: false,
        workflowDockWidth: 520,
        activeSessionId: "other-workspace",
      },
      current,
    );
    expect(merged).toMatchObject({
      rightPanelCollapsed: false,
      defaultRightPanelCollapsed: false,
      workflowDockWidth: 520,
      activeSessionId: "workspace-session",
      sessions: current.sessions,
    });
  });

  it("retains a pending profile update across persistence and rehydration", () => {
    const pendingProfile = {
      ...DEFAULT_USER_PROFILE,
      name: "Offline user",
      updatedAt: "2026-10-20T00:00:00.000Z",
      syncState: "pending",
    };

    const persisted = sessionPersistOptions.migrate({ userProfile: pendingProfile }, 12);
    expect(persisted.userProfile).toEqual(pendingProfile);
    expect(sessionPersistOptions.partialize({ userProfile: pendingProfile })).toEqual({
      userProfile: pendingProfile,
    });

    const restored = sessionPersistOptions.merge(persisted, {
      userProfile: DEFAULT_USER_PROFILE,
    });
    expect(restored.userProfile).toEqual(pendingProfile);
  });

  it("cross-window application preferences exclude session order and model selections", () => {
    expect(
      readPersistedSessionPreferences(
        JSON.stringify({
          state: {
            defaultSidebarCollapsed: true,
            workflowDockWidth: 900,
            motionLevel: "reduced",
            selectedModelProviderId: "main",
            sessionOrder: ["a"],
            runtimeSnapshotsBySession: {},
          },
        }),
      ),
    ).toEqual({ defaultSidebarCollapsed: true, workflowDockWidth: 640, motionLevel: "reduced" });
  });

  it("restores workspace usage and model preferences without storing messages", () => {
    const snapshot = {
      available: true,
      observedAt: "2026-10-10T00:00:00.000Z",
      runtime: {
        sessionId: "s",
        cached: true,
        contextUsage: { tokens: 12000, contextWindow: 100000, percent: 12 },
      },
    };
    expect(
      readWorkspacePreferences(
        JSON.stringify({
          activeSessionId: "s",
          sessionOrder: ["s", "s"],
          selectedModelProviderId: "main",
          selectedThinkingLevel: "high",
          runtimeSnapshotsBySession: { s: snapshot },
          sessions: { s: { messages: ["must not persist"] } },
        }),
      ),
    ).toEqual({
      activeSessionId: "s",
      sessionOrder: ["s"],
      selectedModelProviderId: "main",
      selectedThinkingLevel: "high",
      runtimeSnapshotsBySession: { s: snapshot },
    });
  });

  it("rejects malformed persisted values instead of manufacturing a replacement", () => {
    expect(readPersistedSessionPreferences("{")).toBeNull();
    expect(readPersistedSessionPreferences(JSON.stringify({ state: null }))).toBeNull();
    expect(readPersistedSessionPreferences(JSON.stringify({ state: { motionLevel: "cinematic" } }))).toBeNull();
    expect(() => readWorkspacePreferences(JSON.stringify({ sessionOrder: [42] }))).toThrow();
    expect(() => sessionPersistOptions.migrate({ motionLevel: "cinematic" }, 10)).toThrow();
  });

  it("does not synthesize absent settings for another window", () => {
    expect(readPersistedSessionPreferences(JSON.stringify({ state: { motionLevel: "full" } }))).toEqual({
      motionLevel: "full",
    });
  });
});
