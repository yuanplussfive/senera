import fs from "node:fs";
import path from "node:path";
import { DEFAULT_COMPACTION_SETTINGS, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveAgentPiCompactionSettings } from "../../../Source/AgentSystem/Pi/AgentPiCompactionSettings.js";
import {
  AgentPiCodingAgentSessionPool,
  type AgentPiCodingAgentLeaseInput,
} from "../../../Source/AgentSystem/Pi/AgentPiCodingAgentSessionPool.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { AgentPiSessionCustomEntryTypes } from "../../../Source/AgentSystem/Pi/AgentPiSessionEntries.js";
import { AgentPiSessionExportFormats } from "../../../Source/AgentSystem/Pi/AgentPiSessionManagement.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { relativePathWithin } from "../../../Source/AgentSystem/Core/AgentPath.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentPiModelRuntimeOwner } from "../../../Source/AgentSystem/Pi/AgentPiModelRuntimeOwner.js";
import { AgentPiBackgroundShutdownTracker } from "../../../Source/AgentSystem/Pi/AgentPiBackgroundShutdownTracker.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
});

describe("Pi session management", () => {
  test("rejects queued and future leases once shutdown starts", async () => {
    const workspaceRoot = temporaryWorkspace();
    const pool = createPool(workspaceRoot, "pi-session-lifecycle");
    let allowAcquire!: (release: () => void) => void;
    const blockedAcquire = new Promise<() => void>((resolve) => {
      allowAcquire = resolve;
    });
    const leaseQueue = (pool as unknown as { leases: { acquire(): Promise<() => void> } }).leases;
    const release = vi.fn();
    vi.spyOn(leaseQueue, "acquire").mockReturnValue(blockedAcquire);

    const queuedLease = pool.lease({ sessionId: "queued-session" } as AgentPiCodingAgentLeaseInput);
    const closing = pool.close();
    expect(pool.close()).toBe(closing);
    allowAcquire(release);

    await expect(queuedLease).rejects.toThrow("Pi session pool is draining.");
    await expect(closing).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledOnce();
    await expect(pool.lease({ sessionId: "late-session" } as AgentPiCodingAgentLeaseInput)).rejects.toThrow(
      "Pi session pool is closed.",
    );
  });

  test("propagates pooled session shutdown failures", async () => {
    const workspaceRoot = temporaryWorkspace();
    const pool = createPool(workspaceRoot, "pi-session-shutdown-failure");
    const failure = new Error("session abort failed");
    const sessions = (pool as unknown as { sessions: Map<string, unknown> }).sessions;
    sessions.set("broken-session", {
      session: {
        abort: vi.fn().mockRejectedValue(failure),
        waitForIdle: vi.fn(),
        dispose: vi.fn(),
      },
      disposeDiagnostics: vi.fn(),
    });

    const closing = pool.close();
    await expect(closing).rejects.toBe(failure);
    await expect(pool.close()).rejects.toBe(failure);
  });

  test("retries model runtime creation after a rejected initialization", async () => {
    const config = testConfig();
    const modelProvider = createModelProvider({ Id: "retry-model-runtime" });
    const provider = projectSeneraModelProviderToPi(modelProvider, config);
    const runtime = {
      registerProvider: vi.fn(),
      getModel: vi.fn(() => provider.model),
    };
    const createRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error("runtime initialization failed"))
      .mockResolvedValueOnce(runtime);
    const owner = new AgentPiModelRuntimeOwner({
      provider,
      modelProvider,
      createRuntime: createRuntime as never,
    });

    await expect(owner.get()).rejects.toThrow("runtime initialization failed");
    await expect(owner.get()).resolves.toEqual({ runtime, model: provider.model });
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });

  test("bounds retained background shutdown failures", async () => {
    const tracker = new AgentPiBackgroundShutdownTracker(2);
    tracker.track(Promise.reject(new Error("failure-a")));
    tracker.track(Promise.reject(new Error("failure-b")));
    tracker.track(Promise.reject(new Error("failure-c")));

    await tracker.drain();

    expect(tracker.failureSnapshot().map((failure) => (failure as Error).message)).toEqual([
      "1 earlier Pi background shutdown failures were omitted.",
      "failure-b",
      "failure-c",
    ]);
  });

  test("forks the persisted Pi tree and fixes the target leaf at the requested boundary", async () => {
    const workspaceRoot = temporaryWorkspace();
    const sessionsRoot = path.join(workspaceRoot, ".senera", "pi-sessions");
    const source = SessionManager.create(workspaceRoot, sessionsRoot, { id: "source-session" });
    source.appendMessage({
      role: "user",
      content: "Create a branchable Pi session.",
      timestamp: Date.now(),
    });
    source.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Ready." }],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const boundaryId = source.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, {
      requestId: "request-a",
    });
    source.appendCustomEntry("test.after_boundary", { requestId: "request-b" });

    const config = testConfig();
    const modelProvider = createModelProvider({
      Id: "pi-session-management",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const pool = new AgentPiCodingAgentSessionPool({
      workspaceRoot,
      sessionsRoot,
      systemSkillsRoot: path.join(workspaceRoot, "System", "Skills"),
      provider: projectSeneraModelProviderToPi(modelProvider, config),
      modelProvider,
      compaction: { Enabled: true },
    });

    try {
      const sourceInfo = (await SessionManager.list(workspaceRoot, sessionsRoot)).find(
        (session) => session.id === "source-session",
      );
      expect(sourceInfo).toBeDefined();
      if (!sourceInfo) return;
      expect(SessionManager.open(sourceInfo.path, sessionsRoot, workspaceRoot).getEntry(boundaryId)).toBeDefined();
      await expect(pool.fork("source-session", "target-session", boundaryId)).resolves.toBe(true);
      const targetInfo = (await SessionManager.list(workspaceRoot, sessionsRoot)).find(
        (session) => session.id === "target-session",
      );
      expect(targetInfo).toBeDefined();
      if (!targetInfo) return;

      const target = SessionManager.open(targetInfo.path, sessionsRoot, workspaceRoot);
      expect(target.getLeafEntry()).toMatchObject({
        type: "custom",
        customType: AgentPiSessionCustomEntryTypes.ForkBoundary,
        parentId: boundaryId,
      });
      expect(target.getBranch().map((entry) => entry.id)).toContain(boundaryId);
      expect(
        target.getBranch().some((entry) => "customType" in entry && entry.customType === "test.after_boundary"),
      ).toBe(false);
    } finally {
      await pool.close();
    }
  });

  test("derives compaction reserves from the active model and Pi defaults", () => {
    const config = testConfig();
    const modelProvider = createModelProvider({
      ContextWindowTokens: 4_096,
      MaxModelOutputTokens: 1_024,
    });
    const model = projectSeneraModelProviderToPi(modelProvider, config).model;

    expect(resolveAgentPiCompactionSettings({ Enabled: true }, model)).toEqual({
      enabled: true,
      reserveTokens: model.maxTokens,
      keepRecentTokens: Math.min(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens, model.contextWindow - model.maxTokens),
    });
  });

  test("reports persisted session stats and exports both native formats under the workspace export root", async () => {
    const workspaceRoot = temporaryWorkspace();
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    const sessionsRoot = path.join(layout.stateRoot, "pi-sessions");
    const persisted = SessionManager.create(workspaceRoot, sessionsRoot, { id: "managed-session" });
    persisted.appendMessage({
      role: "user",
      content: "Export this Pi session.",
      timestamp: Date.now(),
    });
    persisted.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Export ready." }],
      api: "openai-completions",
      provider: "test-provider",
      model: "test-model",
      usage: {
        input: 3,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 5,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const config = testConfig();
    const modelProvider = createModelProvider({
      Id: "pi-session-export",
      ContextWindowTokens: 16_384,
      MaxModelOutputTokens: 1_024,
    });
    const pool = new AgentPiCodingAgentSessionPool({
      workspaceRoot,
      sessionsRoot,
      systemSkillsRoot: path.join(workspaceRoot, "System", "Skills"),
      provider: projectSeneraModelProviderToPi(modelProvider, config),
      modelProvider,
      compaction: { Enabled: true },
    });

    try {
      await expect(pool.status("missing-session")).resolves.toBeUndefined();
      await expect(pool.status("managed-session")).resolves.toEqual(
        expect.objectContaining({
          sessionId: "managed-session",
          cached: false,
          stats: expect.objectContaining({
            userMessages: 1,
            assistantMessages: 1,
            tokens: expect.objectContaining({ total: 5 }),
          }),
        }),
      );

      for (const format of Object.values(AgentPiSessionExportFormats)) {
        const exported = await pool.export("managed-session", format);
        expect(exported).toEqual(
          expect.objectContaining({
            sessionId: "managed-session",
            format,
          }),
        );
        if (!exported) continue;
        const absolutePath = path.resolve(workspaceRoot, exported.path);
        expect(relativePathWithin(layout.sessionExportsRoot, absolutePath)).toBeDefined();
        expect(fs.statSync(absolutePath).isFile()).toBe(true);
      }
    } finally {
      await pool.close();
    }
  });
});

function temporaryWorkspace(): string {
  const workspaceRoot = createTemporaryDirectory("senera-pi-session-management");
  temporaryDirectories.push(workspaceRoot);
  fs.mkdirSync(path.join(workspaceRoot, "System", "Skills"), { recursive: true });
  return workspaceRoot;
}

function createPool(workspaceRoot: string, providerId: string): AgentPiCodingAgentSessionPool {
  const config = testConfig();
  const modelProvider = createModelProvider({
    Id: providerId,
    ContextWindowTokens: 16_384,
    MaxModelOutputTokens: 1_024,
  });
  return new AgentPiCodingAgentSessionPool({
    workspaceRoot,
    sessionsRoot: path.join(workspaceRoot, ".senera", "pi-sessions"),
    systemSkillsRoot: path.join(workspaceRoot, "System", "Skills"),
    provider: projectSeneraModelProviderToPi(modelProvider, config),
    modelProvider,
    compaction: { Enabled: true },
  });
}

function testConfig(): AgentSystemConfig {
  return {
    Server: { Host: "127.0.0.1", Port: 8787 },
    ModelProviders: [],
  };
}
