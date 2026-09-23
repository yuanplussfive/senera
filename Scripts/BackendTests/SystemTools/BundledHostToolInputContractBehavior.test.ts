import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AgentBundledHostToolInputContracts } from "../../../Source/AgentSystem/SystemTools/AgentBundledHostToolInputContracts.js";
import { discoverAgentSystemExtensionPackages } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";
import { ensureObjectRootJsonSchema } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";

describe("bundled Host Tool input contracts", () => {
  test("publishes the runtime-owned standard JSON array schemas", () => {
    const contributions = discoverContributions();
    for (const definition of AgentBundledHostToolInputContracts) {
      const contractPath = contributions.get(definition.capability);
      expect(contractPath, definition.capability).toBeDefined();
      const contract = readJson(contractPath!) as { inputSchema?: Record<string, unknown> };
      expect(contract.inputSchema).toEqual(
        ensureObjectRootJsonSchema(z.toJSONSchema(definition.input, { target: "draft-7", io: "input" })),
      );
    }
  });

  test("publishes an explicit object root for every bundled tool contract", () => {
    for (const contractPath of discoverContributions().values()) {
      const contract = readJson(contractPath) as { inputSchema?: Record<string, unknown> };
      expect(contract.inputSchema?.type, contractPath).toBe("object");
    }
  });

  test("declares executable cwd resources for bundled shell tools", () => {
    for (const contractPath of discoverContributions().values()) {
      const contract = readJson(contractPath) as {
        inputSchema?: { properties?: Record<string, unknown> };
        permissions?: string[];
        resources?: Array<{ Capability?: string; Pointer?: string; Parameters?: { Intent?: string } }>;
      };
      if (!contract.permissions?.includes("process:shell") || !contract.inputSchema?.properties?.cwd) continue;

      expect(contract.resources, contractPath).toContainEqual({
        Capability: "senera.workspace.path",
        Pointer: "/cwd",
        Parameters: { Intent: "execute" },
      });
    }
  });

  test("publishes the workspace apply patch contract in its five-operation form", () => {
    const contractPath = discoverContributions().get("workspace.apply_patch");
    expect(contractPath).toBeDefined();
    const inputSchema = (readJson(contractPath!) as { inputSchema: { properties?: Record<string, unknown> } })
      .inputSchema;
    const operations = inputSchema.properties?.operations as {
      items?: { oneOf?: Array<{ properties?: { kind?: { const?: string } } }> };
    };
    const kinds = operations.items?.oneOf?.map(
      (branch) => (branch.properties?.kind as { const?: string } | undefined)?.const,
    );
    expect(kinds).toEqual(["add", "update", "write", "delete", "move"]);

    const update = operations.items?.oneOf?.find(
      (branch) => (branch.properties?.kind as { const?: string })?.const === "update",
    );
    expect(Object.keys(update?.properties ?? {})).toContain("oldStr");
    expect(Object.keys(update?.properties ?? {})).toContain("newStr");
  });

  test("accepts canonical arrays and rejects XML projection wrappers", () => {
    const byCapability = new Map(AgentBundledHostToolInputContracts.map((entry) => [entry.capability, entry.input]));
    const artifact = byCapability.get("artifact.memory.read")!;
    const recall = byCapability.get("memory.recall")!;
    const write = byCapability.get("memory.write")!;

    expect(
      artifact.safeParse({ artifactUris: ["senera://artifact/art_1234567890abcdef12345678"], refs: ["raw"] }).success,
    ).toBe(true);
    expect(
      artifact.safeParse({ artifactUris: { item: ["senera://artifact/art_1234567890abcdef12345678"] } }).success,
    ).toBe(false);
    expect(recall.safeParse({ query: "preference", refs: ["memory://preference/coffee"] }).success).toBe(true);
    expect(recall.safeParse({ refs: ["memory://preference/coffee"] }).success).toBe(true);
    expect(recall.safeParse({}).success).toBe(false);
    expect(recall.safeParse({ query: "preference", refs: { item: ["memory://preference/coffee"] } }).success).toBe(
      false,
    );
    expect(
      write.safeParse({
        summary: "Prefers coffee without sugar.",
        until: "permanent",
      }).success,
    ).toBe(true);
    expect(
      write.safeParse({
        type: "preference",
        subject: "coffee",
        claim: "Prefers coffee without sugar.",
      }).success,
    ).toBe(false);
  });
});

function discoverContributions(): Map<string, string> {
  const root = path.resolve("System", "Extensions");
  const contributions = new Map<string, string>();
  for (const { packageRoot, manifest } of discoverAgentSystemExtensionPackages(root)) {
    for (const contribution of manifest.contributions ?? []) {
      if (contribution.kind === "hostTool") {
        contributions.set(contribution.capability, path.resolve(packageRoot, contribution.contract));
      }
    }
  }
  return contributions;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}
