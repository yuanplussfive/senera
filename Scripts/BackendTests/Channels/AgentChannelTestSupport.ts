import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentChannelsDatabase } from "../../../Source/AgentSystem/Channels/AgentChannelsDatabase.js";

const temporaryRoots: string[] = [];

export function cleanupChannelsTestRoots(): void {
  for (const root of temporaryRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Windows may briefly hold SQLite handles; best-effort cleanup is enough.
    }
  }
}

export function openChannelsTestDatabase(): AgentChannelsDatabase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-channels-"));
  temporaryRoots.push(root);
  return new AgentChannelsDatabase(path.join(root, "channels.sqlite"));
}

export const TestChannelSource = Object.freeze({
  platform: "telegram" as const,
  chatType: "direct" as const,
  chatId: "111111111",
  userId: "222222222",
  displayName: "tester",
});

export const TestGroupChannelSource = Object.freeze({
  platform: "telegram" as const,
  chatType: "group" as const,
  chatId: "-1001234567890",
  userId: "222222222",
});
