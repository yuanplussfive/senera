import { describe, expect, test } from "vitest";
import {
  resolveAgentWorkspaceObserverWorkerExecArgv,
  resolveAgentWorkspaceObserverWorkerUrl,
} from "../../../Source/AgentSystem/Artifacts/AgentWorkspaceObserverWorkerLauncher.js";

describe("AgentWorkspaceObserverWorkerLauncher", () => {
  test("resolves the matching worker entrypoint for source and compiled hosts", () => {
    expect(
      resolveAgentWorkspaceObserverWorkerUrl(
        "file:///E:/senera/Source/AgentSystem/Artifacts/AgentWorkspaceChangeObserverProcess.ts",
      ).pathname,
    ).toMatch(/AgentWorkspaceObserverWorker\.ts$/);
    expect(
      resolveAgentWorkspaceObserverWorkerUrl(
        "file:///E:/senera/Dist/Source/AgentSystem/Artifacts/AgentWorkspaceChangeObserverProcess.js",
      ).pathname,
    ).toMatch(/AgentWorkspaceObserverWorker\.js$/);
  });

  test("removes parent eval arguments before launching a TypeScript worker", () => {
    const execArgv = resolveAgentWorkspaceObserverWorkerExecArgv(true, [
      "--trace-warnings",
      "--eval",
      "console.log('parent')",
    ]);

    expect(execArgv).toContain("--trace-warnings");
    expect(execArgv).not.toContain("--eval");
    expect(execArgv).not.toContain("console.log('parent')");
    expect(execArgv).toContain("--import");
    expect(execArgv.some((argument) => argument.includes("tsx"))).toBe(true);
  });

  test("does not duplicate an inherited TypeScript loader", () => {
    expect(resolveAgentWorkspaceObserverWorkerExecArgv(true, ["--import", "tsx"])).toEqual(["--import", "tsx"]);
  });

  test("does not add TypeScript loader arguments to compiled workers", () => {
    expect(resolveAgentWorkspaceObserverWorkerExecArgv(false, ["--eval", "console.log('parent')"])).toEqual([]);
  });
});
