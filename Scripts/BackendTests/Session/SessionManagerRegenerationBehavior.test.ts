import { describe, expect, test, vi } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentSessionRunSettlementTimeoutError } from "../../../Source/AgentSystem/Session/AgentSessionRunControlPolicy.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import {
  assistantEntry,
  collect,
  completedRun,
  createManagerFixture,
  turnPreparation,
  userEntry,
} from "./SessionManagerTestFixtures.js";

describe("Session manager regeneration behavior", () => {
  test("regenerates by truncating the old branch before submitting the replacement turn", async () => {
    const observedConversationRequestIds: string[][] = [];
    const observedPreparations: unknown[] = [];
    const storeRef: { current?: AgentSessionStore } = {};
    const rewind = vi.fn(async () => true);
    const reset = vi.fn(async () => true);
    const fixture = createManagerFixture({
      piSessionMutations: { rewind, reset },
      loopFactory: () => ({
        run: async (request) => {
          observedConversationRequestIds.push(
            storeRef.current!.loadConversation("session-regenerate").map((entry) => entry.requestId),
          );
          observedPreparations.push(request.preparation);
          return completedRun("request-replacement");
        },
      }),
    });
    storeRef.current = fixture.store;
    await fixture.manager.createSession({ sessionId: "session-regenerate" });
    fixture.store.persistEntries("session-regenerate", [
      userEntry("request-a", "A"),
      assistantEntry("request-a", "Answer A"),
      userEntry("request-b", "B"),
      assistantEntry("request-b", "Answer B"),
    ]);
    fixture.store.persistTurnPreparation("session-regenerate", "request-b", {
      ...turnPreparation("B"),
      piBranchBoundaryId: "boundary-b",
    });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.regenerateFromRequest({
      sessionId: "session-regenerate",
      fromRequestId: "request-b",
      requestId: "request-replacement",
      modelProviderId: "provider-replacement",
      input: "B",
      onEvent: collect(events),
    });

    expect(observedConversationRequestIds).toEqual([["request-a", "request-a", "request-replacement"]]);
    expect(observedPreparations).toEqual([
      expect.objectContaining({ rootCommand: expect.objectContaining({ instruction: "B" }) }),
    ]);
    expect(rewind).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-regenerate",
        entryId: "boundary-b",
      }),
    );
    expect(reset).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-a",
      "request-a",
      "request-replacement",
      "request-replacement",
    ]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: AgentEventKinds.SessionTruncated,
        data: expect.objectContaining({ replacementRequestId: "request-replacement" }),
      }),
    );
  });

  test("waits for an active turn to settle before truncating and starting its replacement", async () => {
    const activeStarted = createDeferred<void>();
    const cancellationObserved = createDeferred<void>();
    const allowCancellationToSettle = createDeferred<void>();
    const piAbortStarted = createDeferred<void>();
    const allowPiSessionToBecomeIdle = createDeferred<void>();
    const replacementStarted = vi.fn();
    const piSessions = new AgentPiActiveSessionRegistry();
    let invocation = 0;
    const fixture = createManagerFixture({
      piSessions,
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-active");
            activeStarted.resolve();
            await waitForAbort(request.signal);
            cancellationObserved.resolve();
            await allowCancellationToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }

          replacementStarted();
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-active-regenerate" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-active-regenerate",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const unregisterPiSession = piSessions.register({
      sessionId: "session-active-regenerate",
      requestId: "request-active",
      step: 1,
      session: {
        abort: async () => {
          piAbortStarted.resolve();
          await allowPiSessionToBecomeIdle.promise;
        },
      } as unknown as AgentPiSession,
    });

    const regeneration = fixture.manager.regenerateFromRequest({
      sessionId: "session-active-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement",
      input: "B",
    });
    await cancellationObserved.promise;

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    allowCancellationToSettle.resolve();
    await Promise.all([activeRun, piAbortStarted.promise]);

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    allowPiSessionToBecomeIdle.resolve();
    await regeneration;
    unregisterPiSession();

    expect(replacementStarted).toHaveBeenCalledOnce();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-replacement",
      "request-replacement",
    ]);
  });

  test("keeps the old branch isolated when active-run settlement times out", async () => {
    const activeStarted = createDeferred<void>();
    const allowRunToSettle = createDeferred<void>();
    const allowPiSessionToBecomeIdle = createDeferred<void>();
    const piSessions = new AgentPiActiveSessionRegistry();
    const replacementStarted = vi.fn();
    let invocation = 0;
    const fixture = createManagerFixture({
      piSessions,
      runControl: { settlementTimeoutMs: 10 },
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            activeStarted.resolve();
            await waitForAbort(request.signal);
            await allowRunToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          replacementStarted();
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-settlement-timeout" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-settlement-timeout",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const unregister = piSessions.register({
      sessionId: "session-settlement-timeout",
      requestId: "request-active",
      step: 1,
      session: {
        abort: () => allowPiSessionToBecomeIdle.promise,
      } as unknown as AgentPiSession,
    });

    await expect(
      fixture.manager.regenerateFromRequest({
        sessionId: "session-settlement-timeout",
        fromRequestId: "request-active",
        requestId: "request-replacement",
        input: "B",
      }),
    ).rejects.toBeInstanceOf(AgentSessionRunSettlementTimeoutError);

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-settlement-timeout").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);
    expect(fixture.store.loadRunSnapshots("session-settlement-timeout")).toEqual([
      expect.objectContaining({ requestId: "request-active", status: "running" }),
    ]);
    expect(fixture.store.get("session-settlement-timeout")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.objectContaining({
          metadata: expect.objectContaining({
            lifecycle: expect.objectContaining({
              cancellation: expect.objectContaining({
                state: "cancellation_pending",
                requestId: "request-active",
              }),
            }),
          }),
        }),
      }),
    );

    allowRunToSettle.resolve();
    allowPiSessionToBecomeIdle.resolve();
    await activeRun;
    unregister();
    await vi.waitFor(() => {
      expect(fixture.store.loadRunSnapshots("session-settlement-timeout")).toEqual([
        expect.objectContaining({ requestId: "request-active", status: "cancelled" }),
      ]);
    });
    expect(fixture.store.get("session-settlement-timeout")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.not.objectContaining({
          metadata: expect.objectContaining({
            lifecycle: expect.objectContaining({ cancellation: expect.anything() }),
          }),
        }),
      }),
    );
  });

  test("starts only the latest regeneration while concurrent commands wait for the same active turn", async () => {
    const activeStarted = createDeferred<void>();
    const cancellationObserved = createDeferred<void>();
    const allowCancellationToSettle = createDeferred<void>();
    const replacementRequestIds: string[] = [];
    let invocation = 0;
    const fixture = createManagerFixture({
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-concurrent");
            activeStarted.resolve();
            await waitForAbort(request.signal);
            cancellationObserved.resolve();
            await allowCancellationToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          replacementRequestIds.push(request.requestId);
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-concurrent-regenerate" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-concurrent-regenerate",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const firstEvents: AgentDomainEvent[] = [];
    const secondEvents: AgentDomainEvent[] = [];
    const first = fixture.manager.regenerateFromRequest({
      sessionId: "session-concurrent-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement-1",
      input: "B",
      onEvent: collect(firstEvents),
    });
    await cancellationObserved.promise;
    const second = fixture.manager.regenerateFromRequest({
      sessionId: "session-concurrent-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement-2",
      input: "B",
      onEvent: collect(secondEvents),
    });

    allowCancellationToSettle.resolve();
    await Promise.all([activeRun, first, second]);

    expect(replacementRequestIds).toEqual(["request-replacement-2"]);
    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        kind: AgentEventKinds.RunCancelled,
        context: expect.objectContaining({ requestId: "request-replacement-1" }),
      }),
    );
    expect(secondEvents).not.toContainEqual(expect.objectContaining({ kind: AgentEventKinds.RunCancellationProgress }));
    expect(secondEvents).toContainEqual(expect.objectContaining({ kind: AgentEventKinds.SessionTruncated }));
    expect(fixture.store.loadConversation("session-concurrent-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-replacement-2",
      "request-replacement-2",
    ]);
  });

  test("replaces the current regeneration lineage after its source request was removed", async () => {
    const firstReplacementStarted = createDeferred<void>();
    const observedPreparations: unknown[] = [];
    let invocation = 0;
    const fixture = createManagerFixture({
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-lineage");
            return completedRun(request.requestId);
          }
          if (invocation === 2) {
            firstReplacementStarted.resolve();
            await waitForAbort(request.signal);
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          observedPreparations.push(request.preparation);
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-regeneration-lineage" });
    await fixture.manager.submitMessage({
      sessionId: "session-regeneration-lineage",
      requestId: "request-source",
      input: "B",
    });
    const first = fixture.manager.regenerateFromRequest({
      sessionId: "session-regeneration-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-1",
      input: "B",
    });
    await firstReplacementStarted.promise;

    const second = fixture.manager.regenerateFromRequest({
      sessionId: "session-regeneration-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-2",
      input: "B",
    });
    await Promise.all([first, second]);

    expect(observedPreparations).toEqual([
      expect.objectContaining({
        piBranchBoundaryId: "boundary-lineage",
        rootCommand: expect.objectContaining({ instruction: "B" }),
      }),
    ]);
    expect(fixture.store.loadConversation("session-regeneration-lineage").map((entry) => entry.requestId)).toEqual([
      "request-lineage-2",
      "request-lineage-2",
    ]);
  });

  test("restores regeneration lineage and preparation after manager reconstruction", async () => {
    let firstInvocation = 0;
    const first = createManagerFixture({
      loopFactory: () => ({
        run: async (request) => {
          firstInvocation += 1;
          if (firstInvocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-persisted-lineage");
          }
          return completedRun(request.requestId);
        },
      }),
    });
    await first.manager.createSession({ sessionId: "session-persisted-lineage" });
    await first.manager.submitMessage({
      sessionId: "session-persisted-lineage",
      requestId: "request-source",
      input: "B",
    });
    await first.manager.regenerateFromRequest({
      sessionId: "session-persisted-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-1",
      input: "B",
    });

    const observedPreparations: unknown[] = [];
    const reconstructed = createManagerFixture({
      repository: first.repository,
      loopFactory: () => ({
        run: async (request) => {
          observedPreparations.push(request.preparation);
          return completedRun(request.requestId);
        },
      }),
    });
    await reconstructed.manager.regenerateFromRequest({
      sessionId: "session-persisted-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-2",
      input: "B",
    });

    expect(observedPreparations).toEqual([
      expect.objectContaining({
        piBranchBoundaryId: "boundary-persisted-lineage",
        rootCommand: expect.objectContaining({ instruction: "B" }),
      }),
    ]);
    expect(reconstructed.store.loadConversation("session-persisted-lineage").map((entry) => entry.requestId)).toEqual([
      "request-lineage-2",
      "request-lineage-2",
    ]);
  });
});
