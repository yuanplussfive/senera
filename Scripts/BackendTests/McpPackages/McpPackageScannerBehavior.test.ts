import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { agentMcpPackageToolName } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageIdentity.js";
import { AgentMcpPackageScanner } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageScanner.js";
import { AgentMcpPackageValidationError } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";
import { AgentMcpPackageSourceKinds } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("standard MCP package discovery", () => {
  test("discovers bundled MCPB packages without a Senera extension manifest", () => {
    const packages = new AgentMcpPackageScanner().scanRoot(
      path.resolve("McpServers"),
      AgentMcpPackageSourceKinds.Bundled,
    );

    expect(
      packages.map((package_) => ({
        name: package_.name,
        descriptorKind: package_.descriptorKind,
        servers: package_.servers.map((server) => server.name),
      })),
    ).toEqual([
      { name: "weather", descriptorKind: "mcpb", servers: ["weather"] },
      { name: "web-research", descriptorKind: "mcpb", servers: ["web-research"] },
    ]);
    expect(packages[0]?.configurationPath).toBe(path.resolve("McpServers", "weather", "manifest.json"));
    expect(packages[0]?.servers[0]?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "QWEATHER_API_KEY", secret: true, provenance: "mcpb" }),
        expect.objectContaining({ id: "WEATHER_UNIT", secret: false, choices: ["m", "i"] }),
      ]),
    );
  });

  test("discovers a standard stdio server configuration", () => {
    const root = fixtureRoot();
    writeMcpPackage(root, "csv-toolkit", {
      execution: localExecution(),
      mcpServers: {
        "csv-toolkit": {
          type: "stdio",
          command: "node",
          args: ["./mcp/server.mjs"],
          cwd: ".",
          env: { CSV_TOKEN: "${CSV_TOKEN}" },
        },
      },
    });

    const packages = new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace);

    expect(packages).toMatchObject([
      {
        name: "csv-toolkit",
        source: AgentMcpPackageSourceKinds.Workspace,
        configurationPath: path.join(root, "csv-toolkit", ".mcp.json"),
        descriptorKind: "legacy",
        servers: [
          {
            name: "csv-toolkit",
            configuration: {
              type: "stdio",
              command: { segments: [{ kind: "literal", value: "node" }] },
            },
          },
        ],
      },
    ]);
    expect(packages[0]?.revision).toMatch(/^[a-f0-9]{64}$/u);
    expect(agentMcpPackageToolName("csv-toolkit", "select-columns")).toBe("mcp__csv_toolkit__select_columns");
  });

  test("reports invalid standard configuration with a source-aware diagnostic", () => {
    const root = fixtureRoot();
    const packageRoot = writeMcpPackage(root, "broken-package", {
      execution: localExecution(),
      mcpServers: { "broken-package": { type: "stdio", command: "" } },
    });

    expect(() => new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace)).toThrowError(
      AgentMcpPackageValidationError,
    );
    try {
      new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentMcpPackageValidationError);
      expect((error as AgentMcpPackageValidationError).diagnostics[0]).toMatchObject({
        code: "mcp.package.configuration",
        filePath: path.join(packageRoot, ".mcp.json"),
        pointer: "/mcpServers/broken-package/command",
      });
    }
  });

  test("rejects removed environment inheritance fields and malformed references", () => {
    const root = fixtureRoot();
    writeMcpPackage(root, "legacy-environment", {
      execution: localExecution(),
      mcpServers: {
        "legacy-environment": { type: "stdio", command: "node", env_vars: ["TOKEN"] },
      },
    });
    expect(() => new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace)).toThrowError(
      AgentMcpPackageValidationError,
    );
    try {
      new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace);
    } catch (error) {
      expect((error as AgentMcpPackageValidationError).diagnostics[0]?.message).toMatch(/Unrecognized key/u);
    }

    fs.rmSync(path.join(root, "legacy-environment"), { recursive: true });
    writeMcpPackage(root, "invalid-reference", {
      execution: localExecution(),
      mcpServers: {
        "invalid-reference": { type: "stdio", command: "node", env: { TOKEN: "${INVALID-NAME}" } },
      },
    });
    expect(() => new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace)).toThrowError(
      AgentMcpPackageValidationError,
    );
    try {
      new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace);
    } catch (error) {
      expect((error as AgentMcpPackageValidationError).diagnostics[0]?.message).toMatch(/reference name is invalid/u);
    }
  });

  test("rejects duplicate server names across package directories", () => {
    const root = fixtureRoot();
    writeMcpPackage(root, "first", {
      execution: localExecution(),
      mcpServers: { shared: { type: "stdio", command: "node" } },
    });
    const second = writeMcpPackage(root, "second", {
      execution: localExecution(),
      mcpServers: { shared: { type: "stdio", command: "node" } },
    });

    expect(() => new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace)).toThrow(
      /already declared/u,
    );
    try {
      new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace);
    } catch (error) {
      expect(error).toBeInstanceOf(AgentMcpPackageValidationError);
      expect((error as AgentMcpPackageValidationError).diagnostics[0]?.filePath).toBe(path.join(second, ".mcp.json"));
    }
  });

  test("rejects conflicting runnable descriptors instead of taking the first match", () => {
    const root = fixtureRoot();
    const packageRoot = writeMcpPackage(root, "conflicted", {
      execution: localExecution(),
      mcpServers: { conflicted: { type: "stdio", command: "node" } },
    });
    fs.writeFileSync(
      path.join(packageRoot, "server.json"),
      `${JSON.stringify({
        name: "example/conflicted",
        version: "1.0.0",
        remotes: [{ type: "streamable-http", url: "https://example.test/mcp" }],
      })}\n`,
    );

    expect(() => new AgentMcpPackageScanner().scanRoot(root, AgentMcpPackageSourceKinds.Workspace)).toThrow(
      /conflicting runnable descriptors/u,
    );
  });

  test("normalizes Registry remote Inputs without guessing Secret fields", () => {
    const root = fixtureRoot();
    const packageRoot = path.join(root, "registry-remote");
    fs.mkdirSync(packageRoot);
    fs.writeFileSync(
      path.join(packageRoot, "server.json"),
      `${JSON.stringify({
        name: "example/registry-remote",
        version: "1.0.0",
        remotes: [
          {
            type: "streamable-http",
            url: "https://example.test/mcp",
            headers: [
              { name: "Authorization", title: "Access token", isRequired: true, isSecret: true },
              { name: "X-Region", title: "Region", default: "cn" },
            ],
          },
        ],
      })}\n`,
    );

    const package_ = new AgentMcpPackageScanner().readPackage(packageRoot, AgentMcpPackageSourceKinds.Workspace);

    expect(package_).toMatchObject({
      descriptorKind: "registry",
      servers: [
        {
          inputs: [
            { id: "Authorization", secret: true, required: true, provenance: "registry" },
            { id: "X-Region", secret: false, defaultValue: "cn", provenance: "registry" },
          ],
          configuration: { type: "http" },
        },
      ],
    });
  });

  test("rejects an ambiguous Registry descriptor with multiple runnable routes", () => {
    const root = fixtureRoot();
    const packageRoot = path.join(root, "ambiguous-registry");
    fs.mkdirSync(packageRoot);
    fs.writeFileSync(
      path.join(packageRoot, "server.json"),
      `${JSON.stringify({
        name: "example/ambiguous",
        version: "1.0.0",
        remotes: [
          { type: "streamable-http", url: "https://one.example.test/mcp" },
          { type: "streamable-http", url: "https://two.example.test/mcp" },
        ],
      })}\n`,
    );

    expect(() => new AgentMcpPackageScanner().readPackage(packageRoot, AgentMcpPackageSourceKinds.Workspace)).toThrow(
      /requires one unambiguous route/u,
    );
  });
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-packages-"));
  temporaryRoots.push(root);
  return root;
}

function writeMcpPackage(collectionRoot: string, packageName: string, configuration: unknown): string {
  const packageRoot = path.join(collectionRoot, packageName);
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, ".mcp.json"), `${JSON.stringify(configuration, null, 2)}\n`);
  return packageRoot;
}

function localExecution() {
  return { targets: ["local"], preferred: "local" };
}
