import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentProfileAvatarStore } from "../../../Source/AgentSystem/Session/AgentProfileAvatarStore.js";
import { AgentUserProfileManager } from "../../../Source/AgentSystem/Session/AgentUserProfile.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/SessionPersistence/InMemorySessionRepository.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("agent user profile avatar persistence", () => {
  test("moves legacy data URLs into the workspace profile resource and persists only its path", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-profile");
    try {
      const repository = new InMemorySessionRepository();
      const manager = new AgentUserProfileManager(repository, new AgentProfileAvatarStore(workspaceRoot));
      const events: unknown[] = [];

      await manager.updateProfile({
        profile: {
          name: "Ada",
          avatarDataUrl: "data:image/png;base64,aGVsbG8=",
          assistant: { name: "Senera", avatarDataUrl: null },
        },
        onEvent: (event) => {
          events.push(event);
        },
      });

      const stored = repository.loadUserProfile();
      expect(stored.avatarDataUrl).toBeNull();
      expect(stored.avatarPath).toMatch(/^\.senera\/profile\/avatars\/user-[a-f0-9]{64}\.png$/u);
      expect(fs.existsSync(path.join(workspaceRoot, stored.avatarPath!))).toBe(true);
      expect(events.at(-1)).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ avatarPath: stored.avatarPath }) }),
      );
    } finally {
      removeDirectory(workspaceRoot);
    }
  });

  test("clears an unreadable profile resource instead of exposing a broken image", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-profile-missing");
    try {
      const repository = new InMemorySessionRepository();
      repository.saveUserProfile({
        name: "Ada",
        avatarDataUrl: null,
        avatarPath: ".senera/profile/avatars/user-deadbeef.png",
      });
      const manager = new AgentUserProfileManager(repository, new AgentProfileAvatarStore(workspaceRoot));
      await manager.emitSnapshot({});

      expect(repository.loadUserProfile().avatarPath).toBeNull();
      expect(repository.loadUserProfile().avatarDataUrl).toBeNull();
    } finally {
      removeDirectory(workspaceRoot);
    }
  });
});
