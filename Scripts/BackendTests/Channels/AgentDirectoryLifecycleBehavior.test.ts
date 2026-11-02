import { describe, expect, test, vi } from "vitest";
import { AgentDirectory } from "../../../Source/AgentSystem/Profile/AgentDirectory.js";
import { AgentDirectoryLifecycle } from "../../../Source/AgentSystem/Profile/AgentDirectoryLifecycle.js";
import { createTestEntityReferences } from "../Support/AgentDirectoryTestFixture.js";
import {
  workspaceAgentInput,
  type AgentDirectorySnapshot,
} from "../../../Source/AgentSystem/Core/AgentDirectoryContract.js";

function fixture() {
  let stored: unknown;
  const repository = {
    loadAgentDirectory: () => stored,
    saveAgentDirectory: (value: AgentDirectorySnapshot) => {
      stored = structuredClone(value);
    },
  };
  const initial = { assistant: { name: "First", avatarPath: null, avatarDataUrl: null } };
  const references = createTestEntityReferences();
  const directory = new AgentDirectory(repository, initial, references);
  const first = directory.get();
  directory.execute({
    type: "agent.create",
    revision: directory.snapshot().revision,
    agent: { ...workspaceAgentInput(first), name: "Second" },
  });
  const second = directory.snapshot().agents[1];
  return { directory, first, second, restart: () => new AgentDirectory(repository, initial, references) };
}

describe("Agent identity and owned data lifecycle", () => {
  test("retains UUID and channel identity across rename, restart and deletion of the original contact", () => {
    const { directory, first, second, restart } = fixture();
    directory.bindOneBotIdentity(100, 200);
    directory.execute({
      type: "agent.update",
      revision: directory.snapshot().revision,
      id: second.id,
      agent: { ...workspaceAgentInput(second), name: "Renamed" },
    });
    const renamed = restart().get(second.id);
    expect(renamed).toMatchObject({ id: second.id, name: "Renamed" });
    expect(renamed.id).toMatch(/^[a-f0-9-]{36}$/u);
    const qqId = renamed.qqUserId;
    directory.execute({ type: "agent.default", revision: directory.snapshot().revision, id: second.id });
    directory.execute({ type: "agent.delete", revision: directory.snapshot().revision, id: first.id });
    directory.completeDeletion(first.id);
    const after = restart();
    after.bindOneBotIdentity(100, 200);
    expect(after.get(second.id).qqUserId).toBe(qqId);
    expect(() => after.get(first.id)).toThrow("Unknown Agent");
  });

  test("persists deletion intent before cleanup, rejects new work, and recovers only the owned Agent", async () => {
    const { directory, first, second, restart } = fixture();
    directory.execute({
      type: "group.create",
      revision: directory.snapshot().revision,
      group: { name: "Shared", memberAgentIds: [first.id, second.id] },
    });
    const failed = new AgentDirectoryLifecycle({
      directory,
      cleanup: vi.fn(async () => {
        throw new Error("locked data");
      }),
    });
    await expect(
      failed.execute({ type: "agent.delete", revision: directory.snapshot().revision, id: second.id }),
    ).rejects.toThrow("locked data");
    const recovered = restart();
    expect(recovered.snapshot().deletingAgentIds).toEqual([second.id]);
    expect(() => recovered.resolve(second.id)).toThrow("being deleted");
    expect(() =>
      recovered.execute({
        type: "group.create",
        revision: recovered.snapshot().revision,
        group: { name: "Invalid", memberAgentIds: [second.id] },
      }),
    ).toThrow("being deleted");
    const cleanup = vi.fn(async () => undefined);
    await new AgentDirectoryLifecycle({ directory: recovered, cleanup }).recover();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: second.id }));
    expect(recovered.snapshot().agents.map((agent) => agent.id)).toEqual([first.id]);
    expect(recovered.snapshot().groups[0].memberAgentIds).toEqual([first.id]);
    expect(recovered.snapshot().deletingAgentIds).toEqual([]);
  });

  test("protects the default and rejects additions of disabled contacts without deleting existing data", async () => {
    const { directory, first, second } = fixture();
    const cleanup = vi.fn(async () => undefined);
    const commands = new AgentDirectoryLifecycle({ directory, cleanup });
    await expect(
      commands.execute({ type: "agent.delete", revision: directory.snapshot().revision, id: first.id }),
    ).rejects.toThrow("default");
    expect(cleanup).not.toHaveBeenCalled();
    directory.execute({
      type: "agent.update",
      revision: directory.snapshot().revision,
      id: second.id,
      agent: { ...workspaceAgentInput(second), enabled: false },
    });
    expect(() =>
      directory.execute({
        type: "group.create",
        revision: directory.snapshot().revision,
        group: { name: "Invalid", memberAgentIds: [second.id] },
      }),
    ).toThrow("disabled");
    expect(directory.get(second.id).id).toBe(second.id);
  });
});
