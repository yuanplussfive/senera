import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentWorkspaceConfigFileName,
  resolveAgentWorkspaceConfigPath,
  resolveAgentWorkspaceLayout,
} from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { ensureAgentWorkspaceStateDirectoryIgnored } from "../../../Source/AgentSystem/Core/AgentWorkspaceStateIgnore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("agent workspace layout", () => {
  test("separates Skills, MCP packages, and database domains under .senera", () => {
    const root = path.resolve("workspace");
    const layout = resolveAgentWorkspaceLayout(root);

    expect(layout.desktopRuntimeRoot).toBe(path.join(root, ".senera", "desktop"));
    expect(layout.configFile).toBe(path.join(root, AgentWorkspaceConfigFileName));
    expect(layout.promptPresetRoot).toBe(path.join(root, "prompts"));
    expect(layout.promptPresetStateFile).toBe(path.join(root, ".senera", "prompt-preset.json"));
    expect(layout.piSessionsRoot).toBe(path.join(root, ".senera", "pi-sessions"));
    expect(layout.logsRoot).toBe(path.join(root, ".senera", "logs"));
    expect(layout.sandboxRuntimeRoot).toBe(path.join(root, ".senera", "sandbox-runtime"));
    expect(layout.skillRoot).toBe(path.join(root, ".senera", "skills"));
    expect(layout.mcpRoot).toBe(path.join(root, ".senera", "mcp"));
    expect(layout.agentRolesRoot).toBe(path.join(root, ".senera", "agents"));
    expect(layout.userPluginsRoot).toBe(path.join(root, ".senera", "user-plugins"));
    expect(layout.projectPluginsRoot).toBe(path.join(root, ".senera", "plugins"));
    expect(layout.userPluginsRoot).not.toBe(layout.projectPluginsRoot);
    expect(layout.databases).toEqual({
      config: path.join(root, ".senera", "data", "config", "config.sqlite"),
      credentials: path.join(root, ".senera", "data", "credentials", "credentials.sqlite"),
      sessions: path.join(root, ".senera", "data", "sessions", "sessions.sqlite"),
      memory: path.join(root, ".senera", "data", "memory", "memory.sqlite"),
      memos: path.join(root, ".senera", "data", "memos", "memos.sqlite"),
      orchestration: path.join(root, ".senera", "data", "orchestration", "orchestration.sqlite"),
      channels: path.join(root, ".senera", "data", "channels", "channels.sqlite"),
      artifactManifestIndex: path.join(root, ".senera", "data", "artifacts", "manifest-index.sqlite"),
      workspaceObserver: path.join(root, ".senera", "data", "workspace-observer", "workspace-observer.sqlite"),
    });
    expect(layout.caches).toEqual({
      toolSearchEmbeddings: path.join(root, ".senera", "data", "tool-search", "embeddings.json"),
      toolObservationSift: path.join(root, ".senera", "data", "tool-observation", "sift"),
      mcpSchemas: path.join(root, ".senera", "data", "mcp", "schemas"),
      workspaceObserverContents: path.join(root, ".senera", "data", "workspace-observer", "contents"),
    });
    expect(layout.configSecretKey).toBe(path.join(root, ".senera", "data", "config", "config-secrets.key"));
    expect(layout.credentialSecretKey).toBe(path.join(root, ".senera", "data", "credentials", "credentials.key"));
    expect(layout.legacyConfigSecretKey).toBe(path.join(root, ".senera", "config-secrets.key"));
  });

  test("resolves relative configuration paths from the workspace and preserves absolute paths", () => {
    const root = path.join(os.tmpdir(), "senera layout with spaces", "项目");
    const external = path.join(os.tmpdir(), "senera-external", "config.json");

    expect(resolveAgentWorkspaceConfigPath(root)).toBe(path.join(root, AgentWorkspaceConfigFileName));
    expect(resolveAgentWorkspaceConfigPath(root, "config/custom.json")).toBe(path.join(root, "config", "custom.json"));
    expect(resolveAgentWorkspaceConfigPath(root, external)).toBe(path.normalize(external));
  });
});

describe("workspace state directory ignore file", () => {
  test("writes itself once and leaves a file the user placed there alone", () => {
    const root = createTemporaryDirectory("senera-state-ignore");
    temporaryDirectories.push(root);
    const ignorePath = path.join(root, ".senera", ".gitignore");

    ensureAgentWorkspaceStateDirectoryIgnored(root);
    expect(fs.readFileSync(ignorePath, "utf8")).toContain("!/skills/**");

    fs.writeFileSync(ignorePath, "*.log\n", "utf8");
    ensureAgentWorkspaceStateDirectoryIgnored(root);
    expect(fs.readFileSync(ignorePath, "utf8")).toBe("*.log\n");
  });

  test.skipIf(!gitAvailable)(
    "keeps runtime state out of a repository while leaving authored directories shareable",
    () => {
      const root = createTemporaryDirectory("senera-state-ignore-git");
      temporaryDirectories.push(root);
      for (const directory of [".senera/data/config", ".senera/logs", ".senera/skills/demo", ".senera/context"]) {
        fs.mkdirSync(path.join(root, ...directory.split("/")), { recursive: true });
      }
      const stateFile = path.join(root, ".senera", "data", "config", "config.sqlite");
      const logFile = path.join(root, ".senera", "logs", "run.log");
      fs.writeFileSync(stateFile, "runtime state", "utf8");
      fs.writeFileSync(logFile, "runtime log", "utf8");
      fs.writeFileSync(path.join(root, ".senera", "skills", "demo", "SKILL.md"), "authored", "utf8");
      fs.writeFileSync(path.join(root, ".senera", "context", "PROJECT.md"), "authored", "utf8");
      ensureAgentWorkspaceStateDirectoryIgnored(root);

      git(root, ["init", "-q"]);
      expect(git(root, ["check-ignore", "-q", stateFile]).status).toBe(0);
      expect(git(root, ["check-ignore", "-q", logFile]).status).toBe(0);
      const visible = git(root, ["status", "--porcelain", "--untracked-files=all"])
        .stdout.split("\n")
        .filter(Boolean)
        .map((line) => path.normalize(line.slice(3).split("/").join(path.sep)))
        .sort();
      expect(visible).toEqual([
        path.join(".senera", ".gitignore"),
        path.join(".senera", "context", "PROJECT.md"),
        path.join(".senera", "skills", "demo", "SKILL.md"),
      ]);
    },
  );
});

function git(cwd: string, args: readonly string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout.replaceAll("\r\n", "\n") };
}
