import { describe, expect, test, vi } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import { AgentSessionStatuses } from "../../../Source/AgentSystem/Session/AgentSession.js";
import { AgentSessionMessageQueueModes } from "../../../Source/AgentSystem/Session/AgentSessionMessageQueueMode.js";
import {
  completedRun,
  createCoordinatorFixture,
  createPendingLoop,
  RecordingPiQueueSession,
} from "./SessionRunCoordinatorTestFixtures.js";

describe("Session run coordinator queue behavior", () => {
  test("cancels and truncates an active turn exactly once", async () => {
    const pendingLoop = createPendingLoop();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop });
    const events: AgentDomainEvent[] = [];
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-cancelled",
      input: "Long-running inspection",
      onEvent: (event) => {
        events.push(event);
      },
    });
    await pendingLoop.started;

    expect(fixture.coordinator.assertAvailable(fixture.session).kind).toBe("busy");
    await expect(
      fixture.coordinator.cancelActiveRun({
        sessionId: fixture.session.id,
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe(true);
    await run;

    expect(await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id })).toBe(false);
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
    expect(fixture.store.loadConversation(fixture.session.id)).toEqual([]);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([]);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        AgentEventKinds.RunCancellationProgress,
        AgentEventKinds.RunCancelled,
        AgentEventKinds.SessionTruncated,
      ]),
    );
    const cancellationStages = events
      .filter((event) => event.kind === AgentEventKinds.RunCancellationProgress)
      .map((event) => event.data);
    expect(cancellationStages[0]).toEqual(expect.objectContaining({ stage: "started" }));
    expect(cancellationStages.at(-1)).toEqual(
      expect.objectContaining({ stage: "completed", durationMs: expect.any(Number) }),
    );
    expect(cancellationStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "component_completed",
          component: "agent_loop",
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          stage: "component_completed",
          component: "pi_session",
          durationMs: expect.any(Number),
        }),
      ]),
    );
  });

  test("routes steer and follow-up input to the active Pi session", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop, piSessions });
    const pi = new RecordingPiQueueSession();
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await pendingLoop.started;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: pi as unknown as AgentPiSession,
    });
    const events: AgentDomainEvent[] = [];

    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-steer",
        input: "Check the package manifest first",
        queueMode: AgentSessionMessageQueueModes.Steer,
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe(true);
    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-follow-up",
        input: "Then summarize the release scripts",
        queueMode: AgentSessionMessageQueueModes.FollowUp,
      }),
    ).resolves.toBe(true);

    expect(pi.steered).toEqual(["Check the package manifest first"]);
    expect(pi.followUps).toEqual(["Then summarize the release scripts"]);
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.requestId)).toEqual([
      "request-active",
      "request-steer",
      "request-follow-up",
    ]);
    expect(events).toEqual([]);

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
  });

  test("does not persist queued input when Pi rejects it", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop, piSessions });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await pendingLoop.started;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: {
        steer: async () => {
          throw new Error("Pi queue is unavailable");
        },
      } as unknown as AgentPiSession,
    });

    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-rejected",
        input: "Change direction",
        queueMode: AgentSessionMessageQueueModes.Steer,
      }),
    ).rejects.toThrow("Pi queue is unavailable");
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
  });

  test("renders queued attachments for Pi and records their parent run", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop, piSessions });
    const pi = new RecordingPiQueueSession();
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await pendingLoop.started;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: pi as unknown as AgentPiSession,
    });

    await fixture.coordinator.enqueueActiveRunMessage({
      session: fixture.session,
      requestId: "request-attachment",
      input: "Inspect the attachment",
      attachments: [
        {
          uploadUri: "senera://upload/upload-a",
          name: "report.txt",
          mime: "text/plain",
          size: 12,
          status: "uploaded",
        },
      ],
      queueMode: AgentSessionMessageQueueModes.Steer,
    });

    expect(pi.steered[0]).toContain("<current_user_message>");
    expect(pi.steered[0]).toContain("<uploadUri>senera://upload/upload-a</uploadUri>");
    expect(fixture.store.loadConversation(fixture.session.id).at(-1)?.metadata?.queue).toEqual({
      parentRequestId: "request-active",
      mode: AgentSessionMessageQueueModes.Steer,
    });

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
  });

  test("waits for the run even when Pi abort rejects first", async () => {
    const runStarted = createDeferred<void>();
    const allowRunToSettle = createDeferred<void>();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({
      piSessions,
      loop: {
        run: async (request) => {
          runStarted.resolve();
          await waitForAbort(request.signal);
          await allowRunToSettle.promise;
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      },
    });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await runStarted.promise;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: {
        abort: async () => {
          throw new Error("Pi abort failed");
        },
      } as unknown as AgentPiSession,
    });
    let stopSettled = false;

    const stop = fixture.coordinator.discardActiveRun(fixture.session).finally(() => {
      stopSettled = true;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    allowRunToSettle.resolve();
    await expect(stop).rejects.toThrow("Pi abort failed");
    await run;
    unregister();
  });

  test("repairs stale running metadata and orphaned snapshots", () => {
    const fixture = createCoordinatorFixture({ loop: { run: async () => completedRun("unused") } });
    fixture.session.status = AgentSessionStatuses.Running;
    fixture.session.activeRequest = {
      requestId: "request-orphaned",
      input: "Interrupted request",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    fixture.store.persistMetadata(fixture.session);
    fixture.store.persistRunSnapshot({
      sessionId: fixture.session.id,
      requestId: "request-orphaned",
      input: "Interrupted request",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const fullSnapshotReader = vi.spyOn(fixture.sessionRepository, "loadRunSnapshots").mockImplementation(() => {
      throw new Error("Full run-snapshot loading is forbidden during restart recovery.");
    });

    expect(fixture.coordinator.assertAvailable(fixture.session).kind).toBe("available");
    fixture.coordinator.cleanupOrphanedRunningSnapshots();

    expect(fixture.session).toMatchObject({ status: AgentSessionStatuses.Idle, activeRequest: undefined });
    expect(fullSnapshotReader).not.toHaveBeenCalled();
    fullSnapshotReader.mockRestore();
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("后端重启") }),
    ]);
  });
});
