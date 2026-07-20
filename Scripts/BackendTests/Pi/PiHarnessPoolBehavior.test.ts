import { afterEach, describe, expect, test } from "vitest";
import type { AgentHarnessResources, PromptTemplate, Skill } from "@earendil-works/pi-agent-core";
import {
  AgentPiHarnessSessionPool,
  type AgentPiHarnessLeaseInput,
} from "../../../Source/AgentSystem/Pi/AgentPiHarnessSessionPool.js";
import { AgentPiSessionStore } from "../../../Source/AgentSystem/Pi/AgentPiSessionStore.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Pi harness pool behavior", () => {
  test("serializes leases for one session, then reuses the configured harness", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const modelProvider = createModelProvider();
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env,
    });
    const persistent = await store.openOrCreate({ sessionId: "session-1" });
    const pool = new AgentPiHarnessSessionPool({
      env,
      provider: projectSeneraModelProviderToPi(modelProvider, config),
      modelProvider,
    });

    const first = await pool.lease(leaseInput(persistent.sessionId, persistent.session, "request-1"));
    let secondResolved = false;
    const secondPromise = pool
      .lease(leaseInput(persistent.sessionId, persistent.session, "request-2"))
      .then((lease) => {
        secondResolved = true;
        return lease;
      });
    await Promise.resolve();

    expect(first.storage).toBe("created");
    expect(secondResolved).toBe(false);
    first.session.dispose();

    const second = await secondPromise;
    expect(second.storage).toBe("existing");
    expect(second.session.getActiveToolNames()).toEqual([]);
    second.session.dispose();
    await pool.close();
  });

  test("returns a released lease only once and closes without a model request", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const modelProvider = createModelProvider();
    const store = new AgentPiSessionStore({
      workspaceRoot,
      sessionsRoot: ".senera/pi-sessions",
      env,
    });
    const persistent = await store.openOrCreate({ sessionId: "session-2" });
    const pool = new AgentPiHarnessSessionPool({
      env,
      provider: projectSeneraModelProviderToPi(modelProvider, config),
      modelProvider,
    });

    const lease = await pool.lease(leaseInput(persistent.sessionId, persistent.session, "request-3"));
    lease.session.dispose();
    lease.session.dispose();
    const reused = await pool.lease(leaseInput(persistent.sessionId, persistent.session, "request-4"));

    expect(reused.storage).toBe("existing");
    reused.session.dispose();
    await pool.close();
  });

  test("resets persistent JSONL state and recreates a clean session", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const store = new AgentPiSessionStore({ workspaceRoot, sessionsRoot: ".senera/pi-sessions", env });
    const opened = await store.openOrCreate({ sessionId: "session-reset" });
    await opened.session.appendMessage({
      role: "user",
      content: [{ type: "text", text: "stale history" }],
      timestamp: Date.now(),
    });

    await expect(store.reset("session-reset")).resolves.toBe(true);
    const recreated = await store.openOrCreate({ sessionId: "session-reset" });

    expect(recreated.storage).toBe("created");
    expect(await recreated.session.getEntries()).toEqual([]);
  });
});

const config: AgentSystemConfig = {
  Server: {
    Host: "127.0.0.1",
    Port: 8787,
  },
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-provider",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
};

function leaseInput(
  sessionId: string,
  session: AgentPiHarnessLeaseInput["session"],
  requestId: string,
): AgentPiHarnessLeaseInput {
  return {
    sessionId,
    session,
    toolSet: {
      fingerprint: "empty-tools",
      activeToolNames: [],
      materialize: () => [],
    },
    resources: emptyResources(),
    resourceFingerprint: "empty-resources",
    frame: {
      sessionId,
      requestId,
      step: 1,
      selectedPromptTemplates: [],
    },
    preflight: async () => undefined,
  };
}

function emptyResources(): AgentHarnessResources<Skill, PromptTemplate> {
  return {
    skills: [],
    promptTemplates: [],
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-pi-pool");
  temporaryDirectories.push(workspace);
  return workspace;
}
