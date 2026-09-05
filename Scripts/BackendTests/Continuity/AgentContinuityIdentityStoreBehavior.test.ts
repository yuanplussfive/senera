import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentContinuityIdentityStore } from "../../../Source/AgentSystem/Continuity/AgentContinuityIdentityStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity identity store", () => {
  test("persists logical identities while rotating the process runtime identity", () => {
    const workspace = createWorkspace();
    const identityPath = resolveAgentWorkspaceLayout(workspace).continuityIdentity;
    const first = new AgentContinuityIdentityStore(identityPath).context({
      worldId: "world-a",
      sessionId: "session-a",
    });
    const second = new AgentContinuityIdentityStore(identityPath).context({
      worldId: "world-a",
      sessionId: "session-b",
    });

    expect(second).toMatchObject({
      workspaceId: first.workspaceId,
      accountId: first.accountId,
      userId: first.userId,
      worldId: "world-a",
      sessionId: "session-b",
    });
    expect(second.runtimeId).not.toBe(first.runtimeId);
    expect(JSON.stringify(second)).not.toContain(path.resolve(workspace));
  });

  test("rejects a damaged identity document instead of replacing it", () => {
    const workspace = createWorkspace();
    const identityPath = resolveAgentWorkspaceLayout(workspace).continuityIdentity;
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    fs.writeFileSync(identityPath, "{not-json", "utf8");

    expect(() => new AgentContinuityIdentityStore(identityPath).context()).toThrow("Continuity identity document");
    expect(fs.readFileSync(identityPath, "utf8")).toBe("{not-json");
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-identity");
  workspaces.add(workspace);
  return workspace;
}
