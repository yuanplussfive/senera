import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentWorkspaceChangeObserver } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceChangeObserver.js";
import { AgentWorkspaceChangeObserverProcess } from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceChangeObserverProcess.js";
import { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { ResolvedAgentArtifactsConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory } from "../Support/AgentTestFixtures.js";

const roots: string[] = [];
const observers: AgentWorkspaceChangeObserver[] = [];
const processObservers: AgentWorkspaceChangeObserverProcess[] = [];

afterEach(async () => {
  await Promise.all(observers.splice(0).map((observer) => observer.close()));
  await Promise.all(processObservers.splice(0).map((observer) => observer.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("AgentWorkspaceChangeObserver", () => {
  test("the observer worker keeps its baseline outside the project in the host-owned state directory", async () => {
    const workspaceRoot = createWorkspace();
    const runtimeStateRoot = createWorkspace();
    const observer = new AgentWorkspaceChangeObserverProcess({
      workspaceRoot,
      runtimeStateRoot,
      config: () => resolveArtifactsConfig({ ModelProviders: [] }),
      logger: new AgentLogger(),
    });
    processObservers.push(observer);
    await observer.beginBatch("hosted-state", ["write-file"]);
    await fs.writeFile(path.join(workspaceRoot, "visible.txt"), "project content\n", "utf8");
    expect(await observer.completeCall("hosted-state", "write-file")).toMatchObject({
      changes: [expect.objectContaining({ path: "visible.txt", status: "added" })],
    });
    await fs.access(path.join(runtimeStateRoot, "data", "workspace-observer", "workspace-observer.sqlite"));
    await expect(fs.access(path.join(workspaceRoot, ".senera", "data", "workspace-observer"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  test("keeps files that predate observer startup out of the added set", async () => {
    const workspaceRoot = createWorkspace();
    const existingFile = path.join(workspaceRoot, "System", "Extensions", "agent.yaml");
    await fs.mkdir(path.dirname(existingFile), { recursive: true });
    await fs.writeFile(existingFile, "name: existing\n", "utf8");

    const observer = createObserver(workspaceRoot);
    await observer.beginBatch("batch-existing", ["call-existing"]);

    expect(await observer.completeCall("batch-existing", "call-existing")).toBeUndefined();
  });

  test("captures a parallel tool batch once and leaves receipt-owned paths to the exact source", async () => {
    const workspaceRoot = createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "edit.ts"), "before\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "obsolete.md"), "remove me\n", "utf8");
    const observer = createObserver(workspaceRoot);
    await observer.beginBatch("batch-1", ["call-second", "call-first"]);

    await fs.writeFile(path.join(workspaceRoot, "src", "edit.ts"), "exact receipt owns this file\n", "utf8");
    await fs.rm(path.join(workspaceRoot, "obsolete.md"));
    await fs.mkdir(path.join(workspaceRoot, "generated", "nested"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "generated", "nested", "output.svg"), "<svg/>\n", "utf8");

    const [first, second] = await Promise.all([
      observer.completeCall("batch-1", "call-second", ["src/edit.ts"]),
      observer.completeCall("batch-1", "call-first"),
    ]);

    expect(first).toMatchObject({
      source: "filesystem-observer",
      coverage: "observed",
      scope: { kind: "tool_batch", id: "batch-1" },
      changes: [
        { path: "generated/nested/output.svg", status: "added" },
        { path: "obsolete.md", status: "deleted" },
      ],
    });
    expect(second).toBeUndefined();
  });

  test("excludes framework state and configured ignored paths while observing other writes", async () => {
    const workspaceRoot = createWorkspace();
    await fs.mkdir(path.join(workspaceRoot, "ignored"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, ".senera"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
    const observer = createObserver(workspaceRoot, { ignoredPaths: ["ignored"] });
    await observer.beginBatch("batch-2", ["call-1"]);

    await fs.writeFile(path.join(workspaceRoot, "ignored", "private.txt"), "ignored\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, ".senera", "state.json"), "{}\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, ".git", "index"), "git state\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "visible.txt"), "visible\n", "utf8");

    const capture = await observer.completeCall("batch-2", "call-1");

    expect(capture?.changes).toEqual([expect.objectContaining({ path: "visible.txt", status: "added" })]);
  });

  test("applies workspace gitignore rules before indexing and observing", async () => {
    const workspaceRoot = createWorkspace();
    await fs.writeFile(path.join(workspaceRoot, ".gitignore"), "generated/\n", "utf8");
    const observer = createObserver(workspaceRoot);
    await observer.beginBatch("batch-gitignore", ["call-1"]);

    await fs.mkdir(path.join(workspaceRoot, "generated"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "generated", "bundle.js"), "ignored\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "source.ts"), "visible\n", "utf8");

    const capture = await observer.completeCall("batch-gitignore", "call-1");

    expect(capture?.changes).toEqual([expect.objectContaining({ path: "source.ts", status: "added" })]);
  });

  test("captures gitignored files created during an active mutation observation", async () => {
    const workspaceRoot = createWorkspace();
    await fs.writeFile(path.join(workspaceRoot, ".gitignore"), ".tmp/\n", "utf8");
    const observer = createObserver(workspaceRoot);
    const lease = await observer.openResourceLease();
    lease.bind("res-gitignored-mutation");

    await fs.mkdir(path.join(workspaceRoot, ".tmp"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".tmp", "versions.json"), '{"node":"v24.10.0"}\n', "utf8");

    const capture = await observer.completeResourceLease("res-gitignored-mutation");

    expect(capture?.changes).toEqual([expect.objectContaining({ path: ".tmp/versions.json", status: "added" })]);
  });

  test("keeps surviving batch observations when one parallel call is cancelled", async () => {
    const workspaceRoot = createWorkspace();
    const observer = createObserver(workspaceRoot);
    await observer.beginBatch("batch-cancel", ["call-cancelled", "call-surviving"]);
    await fs.writeFile(path.join(workspaceRoot, "partial-output.txt"), "side effect completed\n", "utf8");

    const cancelledWaiter = observer.completeCall("batch-cancel", "call-cancelled");
    observer.cancelCall("batch-cancel", "call-cancelled");
    const survivingCapture = observer.completeCall("batch-cancel", "call-surviving");

    await expect(cancelledWaiter).resolves.toBeUndefined();
    expect((await survivingCapture)?.changes).toEqual([
      expect.objectContaining({ path: "partial-output.txt", status: "added" }),
    ]);
  });

  test("preserves hash-based change detection when the text cache budget is exhausted", async () => {
    const workspaceRoot = createWorkspace();
    const filePath = path.join(workspaceRoot, "large.txt");
    await fs.writeFile(filePath, "old data\n", "utf8");
    const observer = createObserver(workspaceRoot, { textCacheBytes: 8 });
    await observer.beginBatch("batch-3", ["call-1"]);
    await fs.writeFile(filePath, "new data\n", "utf8");

    const capture = await observer.completeCall("batch-3", "call-1");

    expect(capture?.status).toBe("bounded");
    expect(capture?.changes).toEqual([expect.objectContaining({ path: "large.txt", status: "modified" })]);
    expect(capture?.before.files[0]?.content).toMatchObject({ state: "omitted", reason: "cache_limit" });
    expect(capture?.after.files[0]?.content).toMatchObject({ state: "omitted", reason: "cache_limit" });
  });

  test("attributes late resource writes to their lease instead of the next tool batch", async () => {
    const workspaceRoot = createWorkspace();
    const observer = createObserver(workspaceRoot);

    await observer.beginBatch("batch-start", ["call-start"]);
    const lease = await observer.openResourceLease();
    lease.bind("res_background");
    expect(await observer.completeCall("batch-start", "call-start")).toBeUndefined();

    await fs.writeFile(path.join(workspaceRoot, ".tmp-output.gif"), Buffer.from("GIF89a"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await observer.beginBatch("batch-wait", ["call-wait"]);
    const unrelatedCapture = await observer.completeCall("batch-wait", "call-wait");
    const capture = await observer.completeResourceLease("res_background");

    expect(capture?.changes).toEqual([expect.objectContaining({ path: ".tmp-output.gif", status: "added" })]);
    expect(unrelatedCapture).toBeUndefined();
  });

  test("does not promote idle workspace writes into a later batch", async () => {
    const workspaceRoot = createWorkspace();
    const observer = createObserver(workspaceRoot);

    await observer.beginBatch("batch-start", ["call-start"]);
    expect(await observer.completeCall("batch-start", "call-start")).toBeUndefined();
    await fs.writeFile(path.join(workspaceRoot, "idle-output.txt"), "outside any tool\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 50));

    await observer.beginBatch("batch-next", ["call-next"]);
    expect(await observer.completeCall("batch-next", "call-next")).toBeUndefined();
  });

  test("does not carry a settled observer warning into later healthy batches", async () => {
    const workspaceRoot = createWorkspace();
    const observer = createObserver(workspaceRoot, { ignoredPaths: ["../outside-workspace"] });
    await observer.beginBatch("batch-warning", ["call-warning"]);

    const warningCapture = await observer.completeCall("batch-warning", "call-warning");
    await observer.beginBatch("batch-healthy", ["call-healthy"]);
    const healthyCapture = await observer.completeCall("batch-healthy", "call-healthy");

    expect(warningCapture).toMatchObject({ status: "degraded", changes: [] });
    expect(warningCapture?.after.warnings).toHaveLength(1);
    expect(healthyCapture).toBeUndefined();
  });

  test("restores the metadata baseline and captured text after the observer is reopened", async () => {
    const workspaceRoot = createWorkspace();
    const filePath = path.join(workspaceRoot, "persisted.txt");
    await fs.writeFile(filePath, "before restart\n", "utf8");
    const firstObserver = createObserver(workspaceRoot);
    await firstObserver.beginBatch("batch-before-restart", ["call-before-restart"]);
    await fs.writeFile(filePath, "after first observer\n", "utf8");
    const firstCapture = await firstObserver.completeCall("batch-before-restart", "call-before-restart");
    expect(firstCapture?.before.files[0]?.content).toMatchObject({ state: "captured", text: "before restart\n" });
    expect(firstCapture?.after.files[0]?.content).toMatchObject({ state: "captured", text: "after first observer\n" });
    await firstObserver.close();

    const secondObserver = createObserver(workspaceRoot);
    await secondObserver.beginBatch("batch-after-restart", ["call-after-restart"]);
    await fs.writeFile(filePath, "after restart\n", "utf8");
    const secondCapture = await secondObserver.completeCall("batch-after-restart", "call-after-restart");

    expect(secondCapture?.before.files[0]?.content).toMatchObject({
      state: "captured",
      text: "after first observer\n",
    });
    expect(secondCapture?.after.files[0]?.content).toMatchObject({ state: "captured", text: "after restart\n" });
  });

  test("releases the observer child after idle and starts it again on the next batch", async () => {
    const workspaceRoot = createWorkspace();
    const defaults = resolveArtifactsConfig({ ModelProviders: [] });
    const config: ResolvedAgentArtifactsConfig = {
      ...defaults,
      WorkspaceObserverSettleMs: 20,
      WorkspaceObserverIdleTtlMs: 50,
      WorkspaceObserverIgnoredPaths: [],
    };
    const observer = new AgentWorkspaceChangeObserverProcess({
      workspaceRoot,
      config: () => config,
      logger: new AgentLogger({ output: process.stderr }),
    });
    processObservers.push(observer);

    await observer.beginBatch("process-batch-first", ["process-call-first"]);
    await fs.writeFile(path.join(workspaceRoot, "first.txt"), "first\n", "utf8");
    expect((await observer.completeCall("process-batch-first", "process-call-first"))?.changes).toEqual([
      expect.objectContaining({ path: "first.txt", status: "added" }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 150));

    await observer.beginBatch("process-batch-second", ["process-call-second"]);
    await fs.writeFile(path.join(workspaceRoot, "second.txt"), "second\n", "utf8");
    expect((await observer.completeCall("process-batch-second", "process-call-second"))?.changes).toEqual([
      expect.objectContaining({ path: "second.txt", status: "added" }),
    ]);
  });
});

function createWorkspace(): string {
  const workspaceRoot = createTemporaryDirectory("senera-workspace-observer");
  roots.push(workspaceRoot);
  return workspaceRoot;
}

function createObserver(
  workspaceRoot: string,
  input: { readonly ignoredPaths?: string[]; readonly textCacheBytes?: number } = {},
): AgentWorkspaceChangeObserver {
  const defaults = resolveArtifactsConfig({ ModelProviders: [] });
  const config: ResolvedAgentArtifactsConfig = {
    ...defaults,
    WorkspaceObserverMemoryMaxBytes: input.textCacheBytes ?? 1_048_576,
    WorkspaceObserverSettleMs: 300,
    WorkspaceObserverIgnoredPaths: input.ignoredPaths ?? [],
  };
  const observer = new AgentWorkspaceChangeObserver({ workspaceRoot, config: () => config });
  observers.push(observer);
  return observer;
}
