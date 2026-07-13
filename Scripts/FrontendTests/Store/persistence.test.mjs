import { describe, expect, it } from "vitest";
import { readPersistedSessionPreferences, sessionPersistOptions } from "../../../Frontend/src/store/session/persistence.ts";
import { DEFAULT_USER_PROFILE } from "../../../Frontend/src/store/session/userProfile.ts";
describe("session persistence migration", () => {
    it("returns default layout preferences without treating runtime collapsed state as durable", () => {
        const migrate = sessionPersistOptions.migrate;
        expect(migrate).toBeDefined();
        const migrated = migrate?.({
            sidebarCollapsed: true,
            rightPanelCollapsed: true,
            defaultSidebarCollapsed: false,
            defaultRightPanelCollapsed: true,
            motionLevel: "none",
            selectedModelProviderId: "provider-1",
            selectedModelProviderIdsBySession: { "legacy-active": "provider-1", invalid: 42 },
            userProfile: {
                name: "Ada",
                avatarDataUrl: null,
                updatedAt: "2026-05-29T08:00:00.000Z",
            },
            activeSessionId: "legacy-active",
            sessions: { "legacy-active": {} },
            sessionOrder: ["legacy-active"],
            viewedRunIdBySession: { "legacy-active": "req-1" },
            modelProviders: [{ id: "provider-1" }],
            historyLoadingIds: { "legacy-active": true },
        }, 1);
        expect(migrated).toEqual({
            defaultSidebarCollapsed: false,
            defaultRightPanelCollapsed: true,
            motionLevel: "full",
            selectedModelProviderId: "provider-1",
            selectedModelProviderIdsBySession: { "legacy-active": "provider-1" },
            userProfile: {
                name: "Ada",
                avatarDataUrl: null,
                updatedAt: "2026-05-29T08:00:00.000Z",
            },
        });
    });
    it("keeps persisted motion level when migrating current preferences", () => {
        const migrate = sessionPersistOptions.migrate;
        expect(migrate).toBeDefined();
        const migrated = migrate?.({
            sidebarCollapsed: false,
            rightPanelCollapsed: true,
            defaultSidebarCollapsed: true,
            defaultRightPanelCollapsed: false,
            motionLevel: "reduced",
            selectedModelProviderId: null,
            userProfile: DEFAULT_USER_PROFILE,
            sessions: { discarded: {} },
        }, 4);
        expect(migrated).toMatchObject({
            defaultSidebarCollapsed: true,
            defaultRightPanelCollapsed: false,
            motionLevel: "reduced",
        });
    });
    it("falls back to full motion when persisted motion level is invalid", () => {
        const migrate = sessionPersistOptions.migrate;
        expect(migrate).toBeDefined();
        const migrated = migrate?.({
            motionLevel: "cinematic",
        }, 4);
        expect(migrated).toMatchObject({
            motionLevel: "full",
        });
    });
});
describe("readPersistedSessionPreferences", () => {
    it("reads persisted UI preferences from the zustand storage envelope", () => {
        expect(readPersistedSessionPreferences(JSON.stringify({
            state: {
                defaultSidebarCollapsed: true,
                defaultRightPanelCollapsed: false,
                motionLevel: "reduced",
                selectedModelProviderId: "main",
                selectedModelProviderIdsBySession: { topic_a: "main", invalid: 1 },
            },
        }))).toEqual({
            defaultSidebarCollapsed: true,
            defaultRightPanelCollapsed: false,
            motionLevel: "reduced",
            selectedModelProviderId: "main",
            selectedModelProviderIdsBySession: { topic_a: "main" },
            userProfile: undefined,
        });
    });
    it("returns null for invalid persisted preference payloads", () => {
        expect(readPersistedSessionPreferences("{")).toBeNull();
        expect(readPersistedSessionPreferences(JSON.stringify({ state: null }))).toBeNull();
    });
    it("falls back to full motion for invalid persisted motion levels", () => {
        expect(readPersistedSessionPreferences(JSON.stringify({
            state: {
                motionLevel: "cinematic",
            },
        }))?.motionLevel).toBe("full");
    });
});
