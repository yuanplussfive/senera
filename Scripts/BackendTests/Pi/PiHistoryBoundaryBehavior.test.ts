import { describe, expect, test } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readAgentPiHistoryBoundary } from "../../../Source/AgentSystem/Pi/AgentPiHistoryBoundaryReader.js";
import { AgentPiSessionCustomEntryTypes } from "../../../Source/AgentSystem/Pi/AgentPiSessionEntries.js";
import { AgentPiHistoryBoundaryReader } from "../../../Source/AgentSystem/Pi/AgentPiHistoryBoundaryReader.js";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Native Pi transcript boundaries", () => {
  test("restores committed boundaries after restart without rewriting native files", async () => {
    const directory = createTemporaryDirectory("senera-pi-history-boundary");
    try {
      const manager = SessionManager.inMemory(directory);
      manager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId: "retained" });
      const kept = manager.appendMessage({ role: "user", content: "Task", timestamp: 1 });
      const id = manager.appendCompaction("Summary", kept, 1000);
      const file = path.join(directory, "session.jsonl");
      const content =
        [{ ...manager.getHeader(), version: 2 }, ...manager.getBranch()]
          .map((entry) => JSON.stringify(entry))
          .join("\n") + "\n";
      await writeFile(file, content);
      const options = { workspaceRoot: directory, sessionsRoot: directory };
      const reader = new AgentPiHistoryBoundaryReader(options);
      expect(await reader.read(manager.getSessionId())).toEqual({ id, firstKeptRequestId: "retained" });
      expect(await new AgentPiHistoryBoundaryReader(options).read(manager.getSessionId())).toEqual({
        id,
        firstKeptRequestId: "retained",
      });
      expect(await readFile(file, "utf8")).toBe(content);
    } finally {
      removeDirectory(directory);
    }
  });
  test("keeps a whole host request when compaction retains a message inside that request", () => {
    const manager = SessionManager.inMemory();
    manager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId: "old" });
    manager.appendMessage({ role: "user", content: "Old task", timestamp: 1 });
    manager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId: "kept" });
    const kept = manager.appendMessage({ role: "user", content: "Keep this whole task", timestamp: 2 });
    const id = manager.appendCompaction("Summary", kept, 1000);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toEqual({ id, firstKeptRequestId: "kept" });
  });

  test("follows retained summaries across repeated compactions and respects branch rewinds", () => {
    const manager = SessionManager.inMemory();
    const root = manager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId: "first" });
    const kept = manager.appendMessage({ role: "user", content: "Task", timestamp: 1 });
    const first = manager.appendCompaction("First summary", kept, 1000);
    const second = manager.appendCompaction("Second summary", first, 2000);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toEqual({ id: second, firstKeptRequestId: "first" });
    manager.branch(root);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toBeUndefined();
  });

  test("does not invent a host boundary when markers or retained entries are absent", () => {
    const manager = SessionManager.inMemory();
    const kept = manager.appendMessage({ role: "user", content: "Legacy message", timestamp: 1 });
    manager.appendCompaction("Legacy", kept, 1000);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toBeUndefined();
    manager.appendCompaction("Missing entry", "missing", 1000);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toBeUndefined();
    manager.appendCompaction("No retained entry", null, 1000);
    expect(readAgentPiHistoryBoundary(manager.getBranch())).toBeUndefined();
  });
});
