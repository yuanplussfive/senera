import { describe, expect, test } from "vitest";
import {
  createAgentContinuityCheckpoint,
  createAgentContinuityLedger,
  createAgentContinuityReference,
  selectAgentContinuityCheckpoint,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityLedger.js";
import { AgentContinuityLayer } from "../../../Source/AgentSystem/Continuity/AgentContinuityLayer.js";

describe("continuity ledger", () => {
  test("deduplicates references and produces a stable revision", () => {
    const input = {
      kind: "conversation" as const,
      uri: "senera://conversation/1",
      revision: "r1",
      summary: "First message",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const first = createAgentContinuityReference(input);
    const duplicate = createAgentContinuityReference(input);
    const left = createAgentContinuityLedger({ scope: "session-1", references: [first] });
    const right = createAgentContinuityLedger({ scope: "session-1", references: [duplicate] });

    expect(left.references).toHaveLength(1);
    expect(left.revision).toBe(right.revision);
    expect(left.references[0]?.digest).toBe(right.references[0]?.digest);
  });

  test("keeps the newest restore point while dropping stale references at the budget", () => {
    const layer = new AgentContinuityLayer("session-1");
    const oldReference = reference("old", "2026-09-01T00:00:00.000Z");
    const latestReference = reference("latest", "2026-09-02T00:00:00.000Z");
    const oldCheckpoint = createAgentContinuityCheckpoint({
      referenceIds: [oldReference.id],
      capturedAt: "2026-09-01T01:00:00.000Z",
      resume: { status: "old" },
    });
    const latestCheckpoint = createAgentContinuityCheckpoint({
      referenceIds: [latestReference.id],
      capturedAt: "2026-09-02T01:00:00.000Z",
      parentCheckpointId: oldCheckpoint.id,
      resume: { status: "latest" },
    });
    layer.ingest({ references: [oldReference, latestReference], checkpoints: [oldCheckpoint, latestCheckpoint] });

    const compacted = layer.compact({ maxReferences: 1, maxCheckpoints: 2 });

    expect(compacted.references.map((entry) => entry.id)).toEqual([latestReference.id]);
    expect(compacted.checkpoints).toEqual([latestCheckpoint]);
    expect(layer.restore()).toEqual({ checkpoint: latestCheckpoint, references: [latestReference] });
  });

  test("does not create a restore point for an empty recall projection", () => {
    const ledger = createAgentContinuityLedger({ scope: "session-1" });
    const layer = new AgentContinuityLayer("session-1", ledger);

    expect(layer.checkpoint({ resume: { status: "empty" } })).toBeUndefined();
    expect(layer.snapshot().checkpoints).toEqual([]);
  });

  test("selects the newest checkpoint compatible with durable work constraints", () => {
    const firstReference = reference("first", "2026-09-01T00:00:00.000Z");
    const secondReference = reference("second", "2026-09-02T00:00:00.000Z");
    const unrelated = createAgentContinuityCheckpoint({
      referenceIds: [firstReference.id],
      capturedAt: "2026-09-03T00:00:00.000Z",
      workItemId: "other-work",
      workspaceRevision: "workspace-1",
      resume: { status: "ready" },
    });
    const compatible = createAgentContinuityCheckpoint({
      referenceIds: [secondReference.id],
      capturedAt: "2026-09-02T00:00:00.000Z",
      workItemId: "target-work",
      workspaceRevision: "workspace-1",
      resume: { status: "ready" },
    });
    const olderCompatible = createAgentContinuityCheckpoint({
      referenceIds: [firstReference.id],
      capturedAt: "2026-09-01T00:00:00.000Z",
      workItemId: "target-work",
      workspaceRevision: "workspace-1",
      resume: { status: "ready" },
    });

    expect(
      selectAgentContinuityCheckpoint([olderCompatible, unrelated, compatible], {
        workItemId: "target-work",
        workspaceRevision: "workspace-1",
        resumeStatus: "ready",
      }),
    ).toBe(compatible);

    const layer = new AgentContinuityLayer(
      "session-1",
      createAgentContinuityLedger({
        scope: "session-1",
        references: [firstReference, secondReference],
        checkpoints: [olderCompatible, unrelated, compatible],
      }),
    );
    expect(layer.restore({ workItemId: "target-work", workspaceRevision: "workspace-1" })?.checkpoint).toBe(compatible);
  });

  test("orders checkpoint timestamps by instant instead of timezone spelling", () => {
    const firstReference = reference("instant-first", "2026-09-01T00:00:00.000Z");
    const secondReference = reference("instant-second", "2026-09-01T00:00:00.000Z");
    const sameInstant = createAgentContinuityCheckpoint({
      referenceIds: [firstReference.id],
      capturedAt: "2026-09-01T08:00:00+08:00",
      resume: { status: "ready" },
    });
    const laterInstant = createAgentContinuityCheckpoint({
      referenceIds: [secondReference.id],
      capturedAt: "2026-09-01T01:00:00Z",
      resume: { status: "ready" },
    });

    expect(selectAgentContinuityCheckpoint([sameInstant, laterInstant])).toBe(laterInstant);
  });
});

function reference(name: string, createdAt: string) {
  return createAgentContinuityReference({
    kind: "conversation",
    uri: `senera://conversation/${name}`,
    revision: name,
    summary: name,
    createdAt,
  });
}
