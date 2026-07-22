import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createAgentMcpFilesystemServerLaunch } from "../../../Source/AgentSystem/Mcp/AgentMcpFilesystemClient.js";
import { resolveMcpServerManifest } from "../../../Source/AgentSystem/Mcp/AgentMcpManifestResolver.js";
import { createAgentMcpNodeRuntimeLaunch } from "../../../Source/AgentSystem/Mcp/AgentMcpNodeRuntime.js";
import {
  createCompiledAgentMcpRuntimeModuleResolver,
  createSourceAgentMcpRuntimeModuleResolver,
} from "../../../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";
import type { PluginMcpServerManifest } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const FixturePaths = {
  workspaceRoot: path.resolve("mcp-node-runtime-workspace"),
  pluginRoot: path.resolve("mcp-node-runtime-plugin"),
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("MCP Node runtime launch", () => {
  test("uses the embedded Electron executable in Node mode without inheriting a conflicting mode", () => {
    const launch = createAgentMcpNodeRuntimeLaunch(
      {
        args: ["C:/runtime/server.js", "C:/workspace"],
        env: { PLUGIN_VALUE: "enabled", ELECTRON_RUN_AS_NODE: "0" },
      },
      { executable: "C:/Program Files/Senera/Senera.exe", isElectron: true },
    );

    expect(launch).toEqual({
      command: "C:/Program Files/Senera/Senera.exe",
      args: ["C:/runtime/server.js", "C:/workspace"],
      env: { PLUGIN_VALUE: "enabled", ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  test("keeps ordinary Node launches free of Electron-specific environment state", () => {
    const environment = { PLUGIN_VALUE: "enabled" };
    const launch = createAgentMcpNodeRuntimeLaunch(
      { args: ["server.js"], env: environment },
      { executable: "/usr/local/bin/node", isElectron: false },
    );

    expect(launch).toEqual({
      command: "/usr/local/bin/node",
      args: ["server.js"],
      env: environment,
    });
    expect(launch.env).not.toBe(environment);
  });

  test("resolves explicit Node and package-bin MCP commands through the current Node runtime", () => {
    const nodeServer = resolveMcpServerManifest(server("${node}", ["server.js"]), context());
    const packageBinServer = resolveMcpServerManifest(
      server("${packageBin:@modelcontextprotocol/server-filesystem:mcp-server-filesystem}", ["${workspaceRoot}"]),
      context(),
    );

    expect(nodeServer).toMatchObject({
      command: process.execPath,
      args: ["server.js"],
      cwd: FixturePaths.workspaceRoot,
    });
    expect(packageBinServer.command).toBe(process.execPath);
    expect(packageBinServer.args[0]).toMatch(/@modelcontextprotocol[\\/]server-filesystem[\\/]dist[\\/]index\.js$/u);
    expect(packageBinServer.args.slice(1)).toEqual([FixturePaths.workspaceRoot]);
  });

  test("leaves an explicit native MCP executable unchanged", () => {
    const resolved = resolveMcpServerManifest(server("C:/tools/mcp-server.exe", ["--stdio"]), context());

    expect(resolved).toEqual({
      id: "fixture",
      command: "C:/tools/mcp-server.exe",
      args: ["--stdio"],
      cwd: FixturePaths.workspaceRoot,
      env: undefined,
    });
  });

  test("uses the same embedded Node launch contract for the direct filesystem client", () => {
    const launch = createAgentMcpFilesystemServerLaunch("C:/workspace", {
      executable: "C:/Program Files/Senera/Senera.exe",
      isElectron: true,
    });

    expect(launch.command).toBe("C:/Program Files/Senera/Senera.exe");
    expect(launch.args[0]).toMatch(/@modelcontextprotocol[\\/]server-filesystem[\\/]dist[\\/]index\.js$/u);
    expect(launch.args.slice(1)).toEqual(["C:/workspace"]);
    expect(launch.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  test("resolves runtime modules from the compiled application bundle", () => {
    const applicationRoot = temporaryDirectory("senera-mcp-application");
    const workspaceRoot = temporaryDirectory("senera-mcp-workspace");
    const pluginRoot = temporaryDirectory("senera-mcp-plugin");
    const modulePath = "Plugins/ExamplePlugin/Runtime.js";
    const compiledEntry = writeFixtureFile(applicationRoot, path.join("Dist", modulePath));

    const resolved = resolveMcpServerManifest(server("${node}", [runtimeModuleArgument(modulePath)]), {
      workspaceRoot,
      pluginRoot,
      runtimeModuleResolver: createCompiledAgentMcpRuntimeModuleResolver(applicationRoot),
    });

    expect(resolved).toMatchObject({
      command: process.execPath,
      args: [compiledEntry],
      cwd: workspaceRoot,
    });
    expect(resolved.args).not.toContain("tsx");
  });

  test("resolves runtime modules from TypeScript sources only in the development composition", () => {
    const sourceRoot = temporaryDirectory("senera-mcp-source");
    const modulePath = "Plugins/ExamplePlugin/Runtime.js";
    const sourceEntry = writeFixtureFile(sourceRoot, "Plugins/ExamplePlugin/Runtime.ts");

    const resolved = resolveMcpServerManifest(server("${node}", [runtimeModuleArgument(modulePath)]), {
      ...context(),
      runtimeModuleResolver: createSourceAgentMcpRuntimeModuleResolver(sourceRoot),
    });

    expect(resolved.args).toEqual(["--import", "tsx", sourceEntry]);
  });

  test("rejects missing compiled runtime modules instead of falling back to source files", () => {
    const applicationRoot = temporaryDirectory("senera-mcp-application");
    const sourceRoot = temporaryDirectory("senera-mcp-source");
    const modulePath = "Plugins/ExamplePlugin/Runtime.js";
    writeFixtureFile(sourceRoot, "Plugins/ExamplePlugin/Runtime.ts");

    expect(() =>
      resolveMcpServerManifest(server("${node}", [runtimeModuleArgument(modulePath)]), {
        ...context(),
        runtimeModuleResolver: createCompiledAgentMcpRuntimeModuleResolver(applicationRoot),
      }),
    ).toThrow(/MCP compiled runtime module is missing/u);
  });
});

function context() {
  return FixturePaths;
}

function server(command: string, args: string[]): PluginMcpServerManifest {
  return {
    Id: "fixture",
    Transport: "stdio",
    Command: command,
    Args: args,
  };
}

function temporaryDirectory(prefix: string): string {
  const directory = createTemporaryDirectory(prefix);
  temporaryDirectories.push(directory);
  return directory;
}

function writeFixtureFile(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export {};\n", "utf8");
  return filePath;
}

function runtimeModuleArgument(modulePath: string): string {
  return `\${runtimeModule:${modulePath}}`;
}
