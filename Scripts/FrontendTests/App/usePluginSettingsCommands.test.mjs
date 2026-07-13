import { describe, expect, it } from "vitest";
import { EventKinds, EventLayers, EventPhases } from "../../../Frontend/src/api/eventTypes.ts";
import { resolvePluginSettingsEvent } from "../../../Frontend/src/app/usePluginSettingsCommands.ts";
function event(kind, data) {
    return {
        channel: "agent.event",
        kind,
        layer: EventLayers.Snapshot,
        phase: EventPhases.Config,
        sequence: 1,
        timestamp: "2026-07-03T00:00:00.000Z",
        data,
    };
}
describe("resolvePluginSettingsEvent", () => {
    it("resolves pending plugin config snapshots as success", () => {
        expect(resolvePluginSettingsEvent(event(EventKinds.PluginConfigSnapshot, {
            plugins: [],
            operation: {
                kind: "update",
                pluginName: "weather",
                requestId: "req-1",
            },
        }), new Set(["req-1"]))).toEqual({
            kind: "plugin_config_success",
            requestId: "req-1",
        });
    });
    it("ignores non-pending plugin config snapshots", () => {
        expect(resolvePluginSettingsEvent(event(EventKinds.PluginConfigSnapshot, {
            plugins: [],
            operation: {
                kind: "update",
                pluginName: "weather",
                requestId: "req-1",
            },
        }), new Set(["req-2"]))).toBeNull();
    });
    it("resolves plugin config failures without claiming main config failures", () => {
        expect(resolvePluginSettingsEvent(event(EventKinds.ConfigFailed, {
            configPath: "PluginConfig.toml",
            message: "invalid plugin config",
            operation: {
                kind: "set_enabled",
                pluginName: "weather",
                requestId: "req-3",
            },
        }), new Set(["req-3"]))).toEqual({
            kind: "plugin_config_failed",
            requestId: "req-3",
            message: "invalid plugin config",
        });
        expect(resolvePluginSettingsEvent(event(EventKinds.ConfigFailed, {
            configPath: "Config.toml",
            message: "invalid config",
            operation: {
                kind: "config_update",
                requestId: "req-4",
            },
        }), new Set(["req-4"]))).toBeNull();
    });
});
