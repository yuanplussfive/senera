import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentPiSessionHistoryMaintenance } from "../../../Source/AgentSystem/Pi/AgentPiSessionHistoryMaintenance.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("Pi session history maintenance", () => {
  test("removes duplicated raw execution details while preserving the session tree and references", async () => {
    const directory = createTemporaryDirectory("senera-pi-session-maintenance");
    const sessionsRoot = path.join(directory, "pi-sessions");
    const sessionDirectory = path.join(sessionsRoot, "workspace");
    const sessionPath = path.join(sessionDirectory, "session.jsonl");
    const hugeResult = "workspace-entry\n".repeat(100_000);
    const entries = [
      {
        type: "session",
        version: 1,
        id: "session-a",
        timestamp: "2026-07-17T00:00:00.000Z",
        cwd: directory,
      },
      {
        type: "message",
        id: "tool-result-a",
        parentId: "assistant-a",
        timestamp: "2026-07-17T00:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-a",
          toolName: "WorkspaceListFiles",
          content: [{ type: "text", text: "bounded model observation" }],
          details: {
            retained: "outer-metadata",
            senera: {
              custom: "retained-metadata",
              result: { files: hugeResult },
              executed: {
                callId: "call-a",
                name: "WorkspaceListFiles",
                result: { files: hugeResult },
                artifact: { artifactUri: "senera://artifact/artifact-a" },
              },
            },
          },
        },
      },
      {
        type: "message",
        id: "assistant-b",
        parentId: "tool-result-a",
        timestamp: "2026-07-17T00:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      },
    ];
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    const original = await readFile(sessionPath, "utf8");
    const maintenance = new AgentPiSessionHistoryMaintenance();

    try {
      const analysis = await maintenance.compact({ sessionsRoot });
      expect(analysis).toMatchObject({
        dryRun: true,
        scannedFiles: 1,
        scannedEntries: 3,
        rewritableFiles: 1,
        rewritableEntries: 1,
        rewrittenFiles: 0,
      });
      expect(analysis.reclaimableBytes).toBeGreaterThan(1_000_000);
      expect(await readFile(sessionPath, "utf8")).toBe(original);

      const applied = await maintenance.compact({ sessionsRoot, dryRun: false });
      expect(applied).toMatchObject({ rewrittenFiles: 1, rewrittenEntries: 1 });
      const rewritten = (await readFile(sessionPath, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rewritten.map((entry) => [entry.type, entry.id])).toEqual(entries.map((entry) => [entry.type, entry.id]));
      expect(rewritten[1]).toMatchObject({
        parentId: "assistant-a",
        message: {
          content: [{ text: "bounded model observation" }],
          details: {
            retained: "outer-metadata",
            senera: {
              custom: "retained-metadata",
              toolName: "WorkspaceListFiles",
              artifactUri: "senera://artifact/artifact-a",
              callId: "call-a",
            },
          },
        },
      });
      expect(JSON.stringify(rewritten[1])).not.toContain("workspace-entry");
      await expect(maintenance.compact({ sessionsRoot })).resolves.toMatchObject({ rewritableEntries: 0 });
    } finally {
      removeDirectory(directory);
    }
  });
});
