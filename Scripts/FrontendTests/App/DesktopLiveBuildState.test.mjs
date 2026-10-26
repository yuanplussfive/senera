import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { isDesktopLiveBuildCurrent } from "../../../Apps/Desktop/DesktopLiveBuildState.ts";

const BuildCompletedAt = Date.now();
let workspaceRoot;
let buildInfoPath;
let mainOutputPath;

afterEach(() => {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("a build stays current while no source is newer than it", () => {
  createWorkspace();
  writeSource("Source/Agent.ts");

  expect(isCurrent()).toBe(true);
});

test("editing a source file invalidates the build", () => {
  createWorkspace();
  const source = writeSource("Source/Agent.ts");
  setMtime(source, BuildCompletedAt + 60_000);

  expect(isCurrent()).toBe(false);
});

test("deleting a source file invalidates the build", () => {
  createWorkspace();
  writeSource("Source/Agent.ts");
  // A deletion updates the containing directory instead of the remaining files.
  setMtime(path.join(workspaceRoot, "Source"), BuildCompletedAt + 60_000);

  expect(isCurrent()).toBe(false);
});

test("a non-TypeScript file does not trigger a compile", () => {
  createWorkspace();
  writeSource("Source/Agent.ts");
  const prompt = writeSource("Source/Prompts.md");
  setMtime(prompt, BuildCompletedAt + 60_000);

  expect(isCurrent()).toBe(true);
});

test("losing the emitted entrypoint forces a compile", () => {
  createWorkspace();
  writeSource("Source/Agent.ts");
  fs.rmSync(mainOutputPath);

  expect(isCurrent()).toBe(false);
});

test("a workspace that never compiled is not current", () => {
  createWorkspace();
  fs.rmSync(buildInfoPath);

  expect(isCurrent()).toBe(false);
});

function isCurrent() {
  return isDesktopLiveBuildCurrent(workspaceRoot, buildInfoPath, mainOutputPath);
}

function createWorkspace() {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-live-build-"));
  buildInfoPath = path.join(workspaceRoot, ".cache", "tsconfig.tsbuildinfo");
  mainOutputPath = path.join(workspaceRoot, "Dist", "Desktop", "Main.js");
  fs.mkdirSync(path.dirname(buildInfoPath), { recursive: true });
  fs.mkdirSync(path.dirname(mainOutputPath), { recursive: true });
  fs.writeFileSync(mainOutputPath, "");
  fs.writeFileSync(buildInfoPath, "{}");
  setMtime(mainOutputPath, BuildCompletedAt - 5_000);
  setMtime(buildInfoPath, BuildCompletedAt);
}

function writeSource(relativePath) {
  const target = path.join(workspaceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "export const value = 1;\n");
  setMtime(target, BuildCompletedAt - 60_000);
  for (let directory = path.dirname(target); directory !== workspaceRoot; directory = path.dirname(directory)) {
    setMtime(directory, BuildCompletedAt - 60_000);
  }
  return target;
}

function setMtime(target, epochMs) {
  const time = new Date(epochMs);
  fs.utimesSync(target, time, time);
}
