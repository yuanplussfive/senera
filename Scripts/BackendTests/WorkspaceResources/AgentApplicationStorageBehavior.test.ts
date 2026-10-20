import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { readAgentDirectoryUsage } from "../../../Source/AgentSystem/WorkspaceResources/AgentApplicationStorage.js";

test("storage usage stays available when a directory becomes unreadable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-storage-usage-"));
  const failure = Object.assign(new Error("Directory changed while measuring."), { code: "ENOTDIR" });
  const readdir = vi.spyOn(fs, "readdir").mockRejectedValue(failure);
  try {
    await expect(readAgentDirectoryUsage(root)).resolves.toEqual({
      bytes: 0,
      coverage: "partial",
      unavailableEntryCount: 1,
    });
  } finally {
    readdir.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("storage usage counts regular files and respects owned-state exclusions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-storage-usage-"));
  const nested = path.join(root, "nested");
  const excluded = path.join(root, ".senera");
  try {
    await Promise.all([fs.mkdir(nested), fs.mkdir(excluded)]);
    await Promise.all([
      fs.writeFile(path.join(root, "root.txt"), "abc"),
      fs.writeFile(path.join(nested, "nested.txt"), "hello"),
      fs.writeFile(path.join(excluded, "state.bin"), "ignored"),
    ]);

    await expect(readAgentDirectoryUsage(root, [excluded])).resolves.toEqual({
      bytes: 8,
      coverage: "complete",
      unavailableEntryCount: 0,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
