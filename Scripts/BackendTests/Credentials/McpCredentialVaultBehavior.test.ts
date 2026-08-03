import fs from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { AgentMcpCredentialService } from "../../../Source/AgentSystem/Credentials/AgentMcpCredentialService.js";
import { AgentMcpInputService } from "../../../Source/AgentSystem/Credentials/AgentMcpInputService.js";
import type { AgentMcpInputDefinition } from "../../../Source/AgentSystem/McpPackages/AgentMcpInputDefinition.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("MCP credential vault", () => {
  test("encrypts server-scoped values and exposes only source metadata", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credentials");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpCredentialService.open(workspaceRoot, { SHARED_TOKEN: "host-value" });
    const secret = "vault-secret-that-must-not-appear-on-disk";

    service.set("research", "SHARED_TOKEN", secret);
    service.set("weather", "SHARED_TOKEN", "weather-value");

    expect(service.resolve("research", "SHARED_TOKEN")).toEqual({ value: secret, source: "vault" });
    expect(service.resolve("weather", "SHARED_TOKEN")).toEqual({ value: "weather-value", source: "vault" });
    expect(service.statuses("research", [{ name: "SHARED_TOKEN", required: true, hasDefault: false }])).toEqual([
      expect.objectContaining({
        name: "SHARED_TOKEN",
        configured: true,
        required: true,
        source: "vault",
      }),
    ]);
    service.close();

    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    expect(fs.readFileSync(layout.databases.credentials).includes(Buffer.from(secret, "utf8"))).toBe(false);
  });

  test("falls back to explicitly referenced host values and defaults without persisting them", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-credential-sources");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpCredentialService.open(workspaceRoot, { HOST_TOKEN: "from-host" });

    expect(service.resolve("research", "HOST_TOKEN")).toEqual({ value: "from-host", source: "environment" });
    expect(
      service.statuses("research", [
        { name: "HOST_TOKEN", required: true, hasDefault: false },
        { name: "OPTIONAL", required: false, hasDefault: true },
        { name: "MISSING", required: true, hasDefault: false },
      ]),
    ).toEqual([
      { name: "HOST_TOKEN", required: true, configured: true, source: "environment" },
      { name: "OPTIONAL", required: false, configured: true, source: "default" },
      { name: "MISSING", required: true, configured: false, source: "missing" },
    ]);
    service.close();
  });

  test("stores ordinary typed inputs separately from encrypted Secrets and revisions", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-typed-inputs");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpInputService.open(workspaceRoot, {});
    const secret = inputDefinition("TOKEN", true);
    const region = inputDefinition("REGION", false, ["cn", "us"]);
    const initial = service.revision();

    service.set("research", secret, "secret-value-not-on-disk");
    const afterSecret = service.revision();
    service.set("research", region, "cn");
    const afterConfig = service.revision();

    expect(afterSecret).not.toBe(initial);
    expect(afterConfig).not.toBe(afterSecret);
    expect(service.resolve("research", secret.binding)).toEqual({ value: "secret-value-not-on-disk", source: "vault" });
    expect(service.resolve("research", region.binding)).toEqual({ value: "cn", source: "configuration" });
    const statuses = service.statuses("research", [secret, region]);
    expect(statuses).toEqual([
      expect.objectContaining({ id: "TOKEN", secret: true, stored: true, source: "vault" }),
      expect.objectContaining({ id: "REGION", secret: false, stored: true, source: "configuration", value: "cn" }),
    ]);
    expect(JSON.stringify(statuses)).not.toContain("secret-value-not-on-disk");
    service.close();

    const database = fs.readFileSync(resolveAgentWorkspaceLayout(workspaceRoot).databases.credentials);
    expect(database.includes(Buffer.from("secret-value-not-on-disk", "utf8"))).toBe(false);
    expect(database.includes(Buffer.from('"cn"', "utf8"))).toBe(true);
  });

  test("validates a batch before atomically committing Secret and ordinary inputs", () => {
    const workspaceRoot = createTemporaryDirectory("senera-mcp-input-batch");
    temporaryDirectories.push(workspaceRoot);
    const service = AgentMcpInputService.open(workspaceRoot, {});
    const secret = inputDefinition("TOKEN", true);
    const region = inputDefinition("REGION", false, ["cn", "us"]);
    const initialRevision = service.revision();

    expect(() =>
      service.update("research", [secret, region], {
        values: { TOKEN: "must-rollback", REGION: "invalid-region" },
      }),
    ).toThrow(/one of the declared choices/u);
    expect(service.revision()).toBe(initialRevision);
    expect(service.resolve("research", secret.binding)).toBeUndefined();
    expect(service.resolve("research", region.binding)).toBeUndefined();

    service.update("research", [secret, region], {
      values: { TOKEN: "committed-secret", REGION: "cn" },
    });
    expect(service.resolve("research", secret.binding)).toEqual({ value: "committed-secret", source: "vault" });
    expect(service.resolve("research", region.binding)).toEqual({ value: "cn", source: "configuration" });

    service.update("research", [secret, region], { values: {}, deletes: ["TOKEN", "REGION"] });
    expect(service.resolve("research", secret.binding)).toBeUndefined();
    expect(service.resolve("research", region.binding)).toBeUndefined();
    service.close();
  });
});

function inputDefinition(id: string, secret: boolean, choices?: readonly string[]): AgentMcpInputDefinition {
  return {
    id,
    title: id,
    type: "string",
    required: true,
    secret,
    multiple: false,
    ...(choices ? { choices: [...choices] } : {}),
    binding: { source: secret ? "secret" : "config", inputId: id },
    provenance: "mcpb",
  };
}
