import { describe, expect, it } from "vitest";
import {
  EventKinds,
  EventLayers,
  EventPhases,
  type EventEnvelope,
} from "../api/eventTypes";
import { resolveSocketPostIngestEffect } from "./useSocketPostIngestEffects";

function event(kind: EventEnvelope["kind"], overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    channel: "agent.event",
    kind,
    layer: EventLayers.Snapshot,
    phase: EventPhases.Config,
    sequence: 1,
    timestamp: "2026-06-08T00:00:00.000Z",
    data: {},
    ...overrides,
  };
}

describe("resolveSocketPostIngestEffect", () => {
  it("refreshes the model list after config reload events", () => {
    expect(resolveSocketPostIngestEffect(event(EventKinds.ConfigReloaded))).toEqual({
      kind: "config_reloaded",
      request: { type: "model.list" },
    });
  });

  it("syncs user profile snapshots after store ingestion", () => {
    const profile = {
      name: "Ada",
      avatarDataUrl: "data:image/png;base64,avatar",
      updatedAt: "2026-06-08T00:00:00.000Z",
    };

    expect(resolveSocketPostIngestEffect(event(EventKinds.ProfileSnapshot, {
      data: profile,
    }))).toEqual({
      kind: "profile_snapshot",
      profile,
    });
  });

  it("ignores events with no app-level post-ingest side effect", () => {
    expect(resolveSocketPostIngestEffect(event(EventKinds.ModelDelta))).toBeNull();
  });
});
