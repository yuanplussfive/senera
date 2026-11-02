import { describe, expect, test } from "vitest";
import { AgentDirectory } from "../../../Source/AgentSystem/Profile/AgentDirectory.js";
import type { AgentDirectorySnapshot } from "../../../Source/AgentSystem/Core/AgentDirectoryContract.js";
import { createTestEntityReferences } from "../Support/AgentDirectoryTestFixture.js";

const identity = { assistant: { name: "Resident", avatarPath: null, avatarDataUrl: null } };

describe("Agent directory participation migration", () => {
  test("migrates activation filters once and preserves group members, identities and presets", () => {
    let stored: unknown;
    const references = createTestEntityReferences();
    const repository = {
      loadAgentDirectory: () => stored,
      saveAgentDirectory: (value: AgentDirectorySnapshot) => {
        stored = value;
      },
    };
    const directory = new AgentDirectory(repository, identity, references);
    directory.bindOneBotIdentity(100, 200);
    const snapshot = directory.snapshot();
    const withGroup = directory.execute({
      type: "group.create",
      revision: snapshot.revision,
      group: { name: "Friends", memberAgentIds: [snapshot.defaultAgentId] },
    });
    stored = {
      ...withGroup,
      version: 1,
      groups: withGroup.groups.map((group) => ({ ...group, replyPolicy: "addressed" })),
    };
    delete (stored as Record<string, unknown>).deletingAgentIds;
    const migrated = new AgentDirectory(repository, identity, references).snapshot();
    expect(migrated.version).toBe(3);
    expect(migrated.revision).toBe(withGroup.revision + 1);
    expect(migrated.agents).toEqual(withGroup.agents);
    expect(migrated.groups).toEqual(withGroup.groups);
    expect(migrated.operatorId).toBe(200);
    expect(new AgentDirectory(repository, identity, references).snapshot()).toEqual(migrated);
  });

  test("rejects unknown versions instead of replacing the saved directory", () => {
    let saved = false;
    expect(
      () =>
        new AgentDirectory(
          {
            loadAgentDirectory: () => ({ version: 999 }),
            saveAgentDirectory: () => {
              saved = true;
            },
          },
          identity,
          createTestEntityReferences(),
        ),
    ).toThrow();
    expect(saved).toBe(false);
  });
});
