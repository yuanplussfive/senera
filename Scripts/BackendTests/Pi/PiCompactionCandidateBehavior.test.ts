import path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  SessionManager,
  type ExtensionAPI,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import {
  AgentPiCompactionCandidateProjectionRevision,
  AgentPiCompactionCandidateCoordinator,
  type AgentPiCompactionCandidateSummaryModel,
  createAgentPiCompactionCandidateRouteDigest,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionCandidateCoordinator.js";
import {
  createAgentPiCompactionCandidate,
  validateAgentPiCompactionCandidate,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionCandidate.js";
import {
  AgentPiCompactionCandidateMemoryStore,
  AgentPiCompactionCandidateSqliteStore,
  type AgentPiCompactionCandidateStore,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionCandidateStore.js";
import {
  AgentPiCompactionCandidateFailurePhases,
  AgentPiCompactionCandidatePhases,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionCandidateLifecycle.js";
import { AgentPiCompactionController } from "../../../Source/AgentSystem/Pi/AgentPiCompactionController.js";
import { prepareAgentPiCompaction } from "../../../Source/AgentSystem/Pi/AgentPiCompactionPreparation.js";
import { AgentPiMutableSessionFrame } from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionFrame.js";
import { canApplyAgentPiCompactionCandidate } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSafety.js";
import { AgentPiRuntimeExtensionFactory } from "../../../Source/AgentSystem/Pi/AgentPiRuntimeExtensionFactory.js";
import {
  AgentPiTurnContextCustomType,
  AgentPiTurnContextElementName,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnContextMessage.js";
import { AgentPiCompactionPromptRevision } from "../../../Source/AgentSystem/PiShared/AgentPiCompactionPrompt.js";
import type { AgentPiProviderProjection } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { projectAgentNativeToolModel } from "../../../Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import {
  boundPiToolObservationView,
  compilePiToolObservation,
  piToolResultMessage,
} from "../Support/PiToolObservationFixtures.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("Pi background compaction candidates", () => {
  test.each([
    [{ isIdle: false, isCompacting: false, pendingMessageCount: 0 }, false],
    [{ isIdle: true, isCompacting: true, pendingMessageCount: 0 }, false],
    [{ isIdle: true, isCompacting: false, pendingMessageCount: 1 }, false],
    [{ isIdle: true, isCompacting: false, pendingMessageCount: 0 }, true],
  ] as const)("applies a ready candidate only at a quiescent Pi boundary: %j", (state, expected) => {
    expect(canApplyAgentPiCompactionCandidate(state)).toBe(expected);
  });

  test("retains newly appended tool evidence when a valid checkpoint projects the active branch", () => {
    const sessionId = "candidate-suffix";
    const manager = SessionManager.inMemory("C:\\workspace");
    const initialMessages = [
      user("Establish the original migration objective.", 1),
      assistant("The first migration checkpoint is complete.", 2),
      user("Continue from the durable checkpoint.", 3),
    ];
    appendMessages(manager, initialMessages);
    const controller = createController(sessionId);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "Original migration work is complete; continue from the checkpoint.",
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    store.replace(candidate);

    const suffixCall = assistantToolCall("call-suffix", "WorkspaceRead", { path: "package.json" }, 4);
    const suffixObservation = compilePiToolObservation({
      callId: "call-suffix",
      toolName: "WorkspaceRead",
      summary: "package.json was read from the active workspace.",
    });
    const suffixResult = piToolResultMessage(
      {
        ...suffixObservation,
        observation_view: boundPiToolObservationView(suffixObservation, {
          complete: false,
          artifact_uri: "senera://artifact/call-suffix",
        }),
      },
      { toolCallId: "call-suffix", toolName: "WorkspaceRead" },
    );
    appendMessages(manager, [suffixCall, suffixResult]);

    const coordinator = createCoordinator({ sessionId, manager, controller, store });
    const selection = coordinator.projectCurrentContext(manager.buildSessionContext().messages);

    expect(selection?.projection.messages[0]).toMatchObject({ role: "compactionSummary", summary: candidate.summary });
    expect(selection?.indexes.artifactIndex.artifacts).toContainEqual(
      expect.objectContaining({ artifactUri: "senera://artifact/call-suffix" }),
    );
    expect(selection?.indexes.toolCallIndex.calls).toContainEqual(
      expect.objectContaining({ callId: "call-suffix", toolName: "WorkspaceRead" }),
    );
    expect(selection?.indexes.continuityLedger?.references).toContainEqual(
      expect.objectContaining({ uri: "senera://tool-call/call-suffix" }),
    );
  });

  test("keeps an active candidate projected after provider usage reflects the smaller request", () => {
    const sessionId = "candidate-projection-epoch";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Earlier work. ".repeat(240), 1),
      assistant("Earlier result. ".repeat(240), 2),
      user("Keep this current task visible.", 3),
    ]);
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(850);
    const controller = createController(sessionId);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "Earlier work is checkpointed; retain the current task.",
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    store.replace(candidate);
    const coordinator = createCoordinator({ sessionId, manager, controller, store, tokenBudget });
    const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 100 };

    const first = coordinator.projectProviderContext(manager.buildSessionContext().messages, settings);
    expect(first?.candidate.id).toBe(candidate.id);

    // Native providers validate the projected wire payload before the request,
    // so the latest provider usage can be much smaller than the raw Pi branch.
    tokenBudget.validateModelInput({ messages: [] });
    expect(tokenBudget.snapshot().occupiedTokens).toBeLessThan(800);

    const second = coordinator.projectProviderContext(manager.buildSessionContext().messages, settings);
    expect(second?.candidate.id).toBe(candidate.id);
  });

  test("invalidates candidates when their branch, route, prompt, or projection contract changes", () => {
    const sessionId = "candidate-validation";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [user("Old task.", 1), assistant("Old result.", 2), user("Keep this turn.", 3)]);
    const controller = createController(sessionId);
    const candidate = createCandidate({ sessionId, manager, controller, summary: "Old task was completed." });
    const route = createAgentPiCompactionCandidateRouteDigest(provider());
    const baseline = {
      sessionId,
      branchEntries: manager.getBranch(),
      modelRouteDigest: route,
      promptRevision: AgentPiCompactionPromptRevision,
      projectionRevision: AgentPiCompactionCandidateProjectionRevision,
    };

    expect(validateAgentPiCompactionCandidate(candidate, baseline)).toMatchObject({ valid: true });
    expect(
      validateAgentPiCompactionCandidate(candidate, { ...baseline, modelRouteDigest: "different-route" }),
    ).toMatchObject({ valid: false, reason: "route_changed" });
    expect(
      validateAgentPiCompactionCandidate(candidate, { ...baseline, promptRevision: "different-prompt" }),
    ).toMatchObject({ valid: false, reason: "prompt_changed" });
    expect(
      validateAgentPiCompactionCandidate(candidate, { ...baseline, projectionRevision: "different-projection" }),
    ).toMatchObject({ valid: false, reason: "projection_changed" });

    const changedPrefix = manager
      .getBranch()
      .map((entry, index) => (index === 1 ? ({ ...entry, parentId: null } as SessionEntry) : entry));
    expect(validateAgentPiCompactionCandidate(candidate, { ...baseline, branchEntries: changedPrefix })).toMatchObject({
      valid: false,
      reason: "snapshot_changed",
    });

    manager.appendCompaction("A later formal compaction", manager.getBranch().at(-1)!.id, 1, {}, true);
    expect(
      validateAgentPiCompactionCandidate(candidate, { ...baseline, branchEntries: manager.getBranch() }),
    ).toMatchObject({
      valid: false,
      reason: "branch_epoch_changed",
    });
  });

  test("binds a BAML candidate to the actual non-secret summary endpoint", () => {
    const runtime = {
      ...provider(),
      providerId: "senera",
      toolPlanningMode: "baml",
      model: {
        ...provider().model,
        api: "senera-planning",
        provider: "senera",
        baseUrl: "senera://planning",
      },
    } as AgentPiProviderProjection;

    const first = createAgentPiCompactionCandidateRouteDigest(runtime, summaryModel("https://primary.example/v1"));
    const changedEndpoint = createAgentPiCompactionCandidateRouteDigest(
      runtime,
      summaryModel("https://replacement.example/v1"),
    );

    expect(first).not.toBe(changedEndpoint);
  });

  test("does not persist a completed background response after cancellation", async () => {
    const sessionId = "candidate-abort";
    const manager = SessionManager.inMemory("C:\\workspace");
    [
      user("Earlier analysis. ".repeat(240), 1),
      assistant("Earlier answer. ".repeat(240), 2),
      user("Keep this current task. ".repeat(80), 3),
    ].forEach((message) => manager.appendMessage(message as never));
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(850);
    let completeSummary: ((summary: string) => void) | undefined;
    const summarize = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          completeSummary = resolve;
        }),
    );
    const controller = new AgentPiCompactionController({
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) as never },
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    const coordinator = createCoordinator({ sessionId, manager, controller, store, tokenBudget });

    coordinator.schedule({ enabled: true, reserveTokens: 100, keepRecentTokens: 100 });
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce());
    coordinator.abortPending(new Error("A foreground request took ownership."));
    completeSummary?.("This response must not become a candidate.");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.list(sessionId)).toEqual([]);
  });

  test("keeps an immutable background candidate across a foreground request boundary", async () => {
    const sessionId = "candidate-foreground-boundary";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Earlier analysis. ".repeat(240), 1),
      assistant("Earlier answer. ".repeat(240), 2),
      user("Keep this current task. ".repeat(80), 3),
    ]);
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(850);
    let completeSummary: ((summary: string) => void) | undefined;
    const summarize = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          completeSummary = resolve;
        }),
    );
    const controller = new AgentPiCompactionController({
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) as never },
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    const coordinator = createCoordinator({ sessionId, manager, controller, store, tokenBudget });

    coordinator.schedule({ enabled: true, reserveTokens: 100, keepRecentTokens: 100 });
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce());

    // A new foreground request observes the same immutable snapshot while the
    // background inference is still running. It must not cancel paid work.
    coordinator.schedule({ enabled: true, reserveTokens: 100, keepRecentTokens: 100 });
    completeSummary?.("This checkpoint remains reusable after the foreground request.");
    await vi.waitFor(() => expect(store.list(sessionId)).toHaveLength(1));

    expect(store.list(sessionId)[0]?.summary).toContain("remains reusable");
  });

  test("notifies the idle-boundary consumer after a candidate becomes ready", async () => {
    const sessionId = "candidate-ready-notification";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Earlier analysis. ".repeat(240), 1),
      assistant("Earlier answer. ".repeat(240), 2),
      user("Keep this current task. ".repeat(80), 3),
    ]);
    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(850);
    const summarize = vi.fn(async () => "A ready checkpoint.");
    const ready = vi.fn();
    const controller = new AgentPiCompactionController({
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) as never },
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    const coordinator = createCoordinator({ sessionId, manager, controller, store, tokenBudget, onReady: ready });

    coordinator.schedule({ enabled: true, reserveTokens: 100, keepRecentTokens: 100 });
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());

    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ summary: "A ready checkpoint." }));
  });

  test("keeps an aborted formal application ready, but discards an application failure", () => {
    const sessionId = "candidate-application-lifecycle";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Establish a checkpoint.", 1),
      assistant("The checkpoint is ready.", 2),
      user("Retain the active task.", 3),
    ]);
    const controller = createController(sessionId);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "The checkpoint remains available after cancellation.",
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    store.replace(candidate);
    const coordinator = createCoordinator({ sessionId, manager, controller, store });

    expect(coordinator.status()).toMatchObject({ phase: AgentPiCompactionCandidatePhases.Ready });
    coordinator.beginFormalApplication(candidate);
    expect(coordinator.status()).toMatchObject({ phase: AgentPiCompactionCandidatePhases.Applying });

    coordinator.restoreFormalApplication(candidate.id);
    expect(coordinator.status()).toMatchObject({ phase: AgentPiCompactionCandidatePhases.Ready });
    expect(coordinator.projectCurrentContext(manager.buildSessionContext().messages)?.candidate.id).toBe(candidate.id);

    coordinator.beginFormalApplication(candidate);
    expect(coordinator.failFormalApplication(candidate.id)).toBe(true);
    expect(store.list(sessionId)).toEqual([]);
    expect(coordinator.status()).toMatchObject({
      phase: AgentPiCompactionCandidatePhases.Failed,
      failurePhase: AgentPiCompactionCandidateFailurePhases.Application,
    });
  });

  test("clears a candidate only after Pi confirms its formal checkpoint commit", () => {
    const sessionId = "candidate-application-complete";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [user("Summarize the completed work.", 1), assistant("Work is complete.", 2)]);
    const controller = createController(sessionId);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "The completed work is represented by this checkpoint.",
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    store.replace(candidate);
    const coordinator = createCoordinator({ sessionId, manager, controller, store });

    coordinator.beginFormalApplication(candidate);
    coordinator.completeFormalCompaction(candidate.id);

    expect(store.list(sessionId)).toEqual([]);
    expect(coordinator.status()).toMatchObject({ phase: AgentPiCompactionCandidatePhases.Idle });
  });

  test("rejects a ready candidate whose retained boundary no longer fits the idle compaction cut", () => {
    const sessionId = "candidate-idle-boundary";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(
      manager,
      [
        "Old user context. ",
        "Old assistant context. ",
        "More historical context. ",
        "Recent result. ",
        "Current task. ",
      ].map((text, index) =>
        index % 2 === 0 ? user(text.repeat(180), index + 1) : assistant(text.repeat(180), index + 1),
      ),
    );
    const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 100 };
    const preparation = prepareAgentPiCompaction(manager.getBranch(), settings);
    const requestedIndex = manager.getBranch().findIndex((entry) => entry.id === preparation?.firstKeptEntryId);
    expect(requestedIndex).toBeGreaterThan(0);
    const staleBoundary = manager.getBranch()[requestedIndex - 1];
    if (!staleBoundary) throw new Error("Expected an older compaction boundary for the test.");

    const controller = createController(sessionId);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "This checkpoint retains too much history for the current cut.",
      firstKeptEntryId: staleBoundary.id,
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    store.replace(candidate);
    const coordinator = createCoordinator({ sessionId, manager, controller, store });

    expect(coordinator.selectForIdleCompaction(settings)).toBeUndefined();
  });

  test("builds a background candidate from the same overlay-free transcript as formal compaction", async () => {
    const sessionId = "candidate-overlay-free";
    const manager = SessionManager.inMemory("C:\\workspace");
    const legacyPayload = "obsolete host snapshot ".repeat(4_000);
    appendMessages(manager, [
      user("Earlier analysis. ".repeat(240), 1),
      legacyTurnContext(legacyPayload, 2),
      assistant("Earlier answer. ".repeat(240), 3),
      user("Keep this current task. ".repeat(80), 4),
    ]);
    const rawMessages = manager.buildSessionContext().messages;
    expect(rawMessages.some((message) => messageText(message).includes(legacyPayload))).toBe(true);

    const tokenBudget = new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 1_000,
      outputReserveTokens: 100,
    });
    tokenBudget.recordProviderInputTokens(850);
    let summarizedMessages: readonly AgentMessage[] = [];
    const summarize = vi.fn(async (input: { readonly messages: readonly AgentMessage[] }) => {
      summarizedMessages = input.messages;
      return "A compact checkpoint without the obsolete host snapshot.";
    });
    const controller = new AgentPiCompactionController({
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) as never },
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    const coordinator = createCoordinator({ sessionId, manager, controller, store, tokenBudget });

    coordinator.schedule({ enabled: true, reserveTokens: 100, keepRecentTokens: 100 });
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce());

    expect(summarizedMessages.some((message) => messageText(message).includes(legacyPayload))).toBe(false);
  });

  test("commits a ready candidate without a second summary call and never leaks a cancelled staging area", async () => {
    const sessionId = "candidate-formal-commit";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Establish the migration state.", 1),
      assistant("The durable migration checkpoint is ready.", 2),
      user("Keep the newest work visible.", 3),
    ]);
    const controller = createController(sessionId);
    const modelProvider = createModelProvider({
      Endpoint: "Responses",
      Model: "test-model",
      ProviderId: "test-provider",
      ToolPlanningMode: "native",
      ContextWindowTokens: 1_000,
      MaxModelOutputTokens: 100,
    });
    const store = new AgentPiCompactionCandidateMemoryStore();
    const candidate = createCandidate({
      sessionId,
      manager,
      controller,
      summary: "Use the durable migration checkpoint.",
      modelRouteDigest: createAgentPiCompactionCandidateRouteDigest(
        provider(),
        projectAgentNativeToolModel(modelProvider),
      ),
    });
    store.replace(candidate);
    const summarize = vi.fn(async () => {
      throw new Error("The on-demand summary request should not be reached for a ready candidate.");
    });
    const registration = new AgentPiRuntimeExtensionFactory({
      provider: provider(),
      modelProvider,
      planningCompilerFactory: { create: () => ({ compile: vi.fn(), summarize }) as never },
      compactionCandidateStore: store,
    }).create(createFrame(sessionId), manager);
    const handlers = new Map<string, (event: never) => unknown>();
    await registration.factory({
      on: (name: string, handler: unknown) => handlers.set(name, handler as (event: never) => unknown),
    } as unknown as ExtensionAPI);
    let notifySession: ((event: never) => void) | undefined;
    registration.install(
      {
        agent: {
          state: { messages: manager.buildSessionContext().messages },
          prepareNextTurnWithContext: undefined,
        },
        subscribe: (listener: unknown) => {
          notifySession = listener as (event: never) => void;
          return () => undefined;
        },
      } as never,
      { enabled: true, reserveTokens: 100, keepRecentTokens: 100 },
    );

    const beforeCompact = handlers.get("session_before_compact");
    const compacted = handlers.get("session_compact");
    expect(beforeCompact).toBeDefined();
    expect(compacted).toBeDefined();

    const candidateResult = await beforeCompact?.(createBeforeCompactEvent(manager, "threshold") as never);
    expect(candidateResult).toMatchObject({
      compaction: {
        summary: candidate.summary,
        firstKeptEntryId: candidate.firstKeptEntryId,
      },
    });
    expect(summarize).not.toHaveBeenCalled();

    notifySession?.({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: true,
      willRetry: false,
    } as never);
    const restored = await beforeCompact?.(createBeforeCompactEvent(manager, "threshold") as never);
    expect(restored).toMatchObject({ compaction: { summary: candidate.summary } });

    notifySession?.({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
      errorMessage: "Compaction failed: storage error",
    } as never);
    expect(store.list(sessionId)).toEqual([]);

    // Pi can cancel between its before/after events. Simulate a subsequent
    // failed manual compaction and ensure it cannot inherit the old candidate
    // indexes when an after event is eventually observed.
    store.remove(candidate.id);
    await expect(
      beforeCompact?.(createBeforeCompactEvent(manager, "manual", "Apply user-specific instructions.") as never),
    ).rejects.toThrow("on-demand summary request");

    const entriesBefore = manager.getBranch().length;
    await compacted?.({ type: "session_compact" } as SessionCompactEvent as never);
    expect(manager.getBranch()).toHaveLength(entriesBefore);
  });

  test("persists only coherent candidates across SQLite runtime restart", () => {
    const workspace = createTemporaryDirectory("senera-pi-compaction-candidate");
    workspaces.add(workspace);
    const sessionId = "candidate-sqlite";
    const manager = SessionManager.inMemory("C:\\workspace");
    appendMessages(manager, [
      user("Persist this checkpoint.", 1),
      assistant("Checkpoint source.", 2),
      user("Retained source.", 3),
    ]);
    const candidate = createCandidate({
      sessionId,
      manager,
      controller: createController(sessionId),
      summary: "Persisted candidate summary.",
    });
    const databasePath = path.join(workspace, "memory.sqlite");
    const first = openCandidateDatabase(databasePath);
    new AgentPiCompactionCandidateSqliteStore(first).replace(candidate);
    first.close();

    const reopened = openCandidateDatabase(databasePath);
    const store = new AgentPiCompactionCandidateSqliteStore(reopened);
    expect(store.list(sessionId)).toEqual([candidate]);
    const coordinator = createCoordinator({
      sessionId,
      manager,
      controller: createController(sessionId),
      store,
    });
    expect(coordinator.status()).toMatchObject({ phase: AgentPiCompactionCandidatePhases.Ready });

    reopened.connection
      .prepare("UPDATE pi_compaction_candidates SET snapshot_leaf_id = ? WHERE candidate_id = ?")
      .run("tampered-leaf", candidate.id);
    expect(store.list(sessionId)).toEqual([]);
    expect(reopened.connection.prepare("SELECT COUNT(*) AS count FROM pi_compaction_candidates").get()).toEqual({
      count: 0,
    });
    reopened.close();
  });
});

function createCandidate(input: {
  readonly sessionId: string;
  readonly manager: SessionManager;
  readonly controller: AgentPiCompactionController;
  readonly summary: string;
  readonly modelRouteDigest?: string;
  readonly firstKeptEntryId?: string;
}) {
  const entries = input.manager.getBranch();
  const boundary = entries.at(-1);
  if (!boundary) throw new Error("Test candidate requires a branch boundary.");
  return createAgentPiCompactionCandidate({
    id: `candidate-${input.sessionId}`,
    sessionId: input.sessionId,
    branchEntries: entries,
    snapshotLeafId: boundary.id,
    firstKeptEntryId: input.firstKeptEntryId ?? boundary.id,
    tokensBefore: 256,
    summary: input.summary,
    indexes: input.controller.createIndexes(entries, input.manager.buildSessionContext().messages.slice(0, -1)),
    modelRouteDigest: input.modelRouteDigest ?? createAgentPiCompactionCandidateRouteDigest(provider()),
    promptRevision: AgentPiCompactionPromptRevision,
    projectionRevision: AgentPiCompactionCandidateProjectionRevision,
    createdAt: "2026-09-19T00:00:00.000Z",
  });
}

function createCoordinator(input: {
  readonly sessionId: string;
  readonly manager: SessionManager;
  readonly controller: AgentPiCompactionController;
  readonly store: AgentPiCompactionCandidateStore;
  readonly tokenBudget?: AgentTurnTokenBudget;
  readonly onReady?: (candidate: unknown) => void;
}): AgentPiCompactionCandidateCoordinator {
  return new AgentPiCompactionCandidateCoordinator({
    frame: createFrame(input.sessionId, input.tokenBudget),
    sessionManager: input.manager,
    provider: provider(),
    compactionController: input.controller,
    store: input.store,
    ...(input.onReady ? { onReady: input.onReady } : {}),
  });
}

function createFrame(sessionId: string, tokenBudget?: AgentTurnTokenBudget): AgentPiMutableSessionFrame {
  const grant = createAgentToolAccessGrant({ authorizedToolNames: [], exposedToolNames: [] });
  return new AgentPiMutableSessionFrame({
    sessionId,
    skillCatalogFingerprint: "test",
    nativeProviderToolNames: [],
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    selectedPromptTemplates: [],
    ...(tokenBudget ? { tokenBudget } : {}),
    preflight: async () => undefined,
  });
}

function createBeforeCompactEvent(
  manager: SessionManager,
  reason: SessionBeforeCompactEvent["reason"],
  customInstructions?: string,
): SessionBeforeCompactEvent {
  const branchEntries = manager.getBranch();
  const firstKeptEntryId = branchEntries.at(-1)?.id;
  if (!firstKeptEntryId) throw new Error("Test compaction requires a branch entry.");
  return {
    type: "session_before_compact",
    preparation: {
      messagesToSummarize: manager.buildSessionContext().messages,
      turnPrefixMessages: [],
      previousSummary: undefined,
      isSplitTurn: false,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 100 },
      firstKeptEntryId,
      tokensBefore: 100,
    },
    branchEntries,
    ...(customInstructions ? { customInstructions } : {}),
    reason,
    willRetry: false,
    signal: new AbortController().signal,
  };
}

function createController(scope: string): AgentPiCompactionController {
  return new AgentPiCompactionController({
    planningCompilerFactory: {
      create: () =>
        ({
          compile: async () => ({ kind: "final_text", content: "", toolCalls: [] }),
          summarize: async () => "",
        }) as never,
    },
    continuityScope: () => scope,
  });
}

function provider(): AgentPiProviderProjection {
  return {
    providerId: "test-provider",
    toolPlanningMode: "native",
    model: {
      api: "openai-responses",
      provider: "test-provider",
      id: "test-model",
      contextWindow: 1_000,
      maxTokens: 100,
    },
  } as AgentPiProviderProjection;
}

function summaryModel(baseUrl: string): AgentPiCompactionCandidateSummaryModel {
  return {
    provider: "test-provider",
    api: "openai-responses",
    id: "test-model",
    baseUrl,
    reasoning: false,
    contextWindow: 1_000,
    maxTokens: 100,
  };
}

function openCandidateDatabase(databasePath: string): AgentSqliteDatabaseKernel {
  return new AgentSqliteDatabaseKernel({ databasePath, contract: AgentMemoryDatabaseContract });
}

function user(content: string, timestamp: number): AgentMessage {
  return { role: "user", content, timestamp } as AgentMessage;
}

function assistant(content: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    timestamp,
  } as AgentMessage;
}

function assistantToolCall(
  callId: string,
  name: string,
  argumentsValue: Record<string, unknown>,
  timestamp: number,
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name, arguments: argumentsValue }],
    timestamp,
  } as AgentMessage;
}

function appendMessages(manager: SessionManager, messages: readonly AgentMessage[]): void {
  for (const message of messages) manager.appendMessage(message as never);
}

function legacyTurnContext(payload: string, timestamp: number): AgentMessage {
  return {
    role: "custom",
    customType: AgentPiTurnContextCustomType,
    content: `<${AgentPiTurnContextElementName} attribution="root">${payload}</${AgentPiTurnContextElementName}>`,
    display: false,
    timestamp,
  } as AgentMessage;
}

function messageText(message: AgentMessage): string {
  const content = "content" in message ? message.content : undefined;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { readonly type?: unknown; readonly text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}
