import { describe, expect, it } from "vitest";
import { EventKinds, EventLayers, EventPhases } from "../../../Frontend/src/api/eventTypes.ts";
import { resolvePresetEvent } from "../../../Frontend/src/app/usePresetCommands.ts";
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
describe("resolvePresetEvent", () => {
  it("resolves pending preset snapshots as success", () => {
    expect(
      resolvePresetEvent(
        event(EventKinds.PresetSnapshot, {
          enabled: true,
          rootDir: ".senera/presets",
          activePresetName: "writer.md",
          presets: [],
          operation: {
            kind: "save",
            name: "writer.md",
            requestId: "req-1",
          },
        }),
        new Set(["req-1"]),
      ),
    ).toEqual({
      kind: "preset_success",
      requestId: "req-1",
      name: "writer.md",
    });
  });
  it("ignores non-pending preset snapshots", () => {
    expect(
      resolvePresetEvent(
        event(EventKinds.PresetSnapshot, {
          enabled: true,
          rootDir: ".senera/presets",
          activePresetName: null,
          presets: [],
          operation: {
            kind: "list",
          },
        }),
        new Set(["req-1"]),
      ),
    ).toBeNull();
  });
  it("resolves pending preset failures", () => {
    expect(
      resolvePresetEvent(
        event(EventKinds.PresetFailed, {
          message: "invalid preset",
          operation: {
            kind: "delete",
            name: "writer.md",
            requestId: "req-2",
          },
        }),
        new Set(["req-2"]),
      ),
    ).toEqual({
      kind: "preset_failed",
      requestId: "req-2",
      message: "invalid preset",
    });
  });
});
