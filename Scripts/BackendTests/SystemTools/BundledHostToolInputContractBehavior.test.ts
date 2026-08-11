import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AgentBundledHostToolInputContracts } from "../../../Source/AgentSystem/SystemTools/AgentBundledHostToolInputContracts.js";
import { AgentSystemExtensionManifestSchema } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";

describe("bundled Host Tool input contracts", () => {
  test("publishes the runtime-owned standard JSON array schemas", () => {
    const contributions = discoverContributions();
    for (const definition of AgentBundledHostToolInputContracts) {
      const contractPath = contributions.get(definition.capability);
      expect(contractPath, definition.capability).toBeDefined();
      const contract = readJson(contractPath!) as { inputSchema?: Record<string, unknown> };
      expect(contract.inputSchema).toEqual(z.toJSONSchema(definition.input, { target: "draft-7", io: "input" }));
    }
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
    expect(recall.safeParse({ query: "preference", refs: { item: ["memory://preference/coffee"] } }).success).toBe(
      false,
    );
    expect(
      write.safeParse({
        type: "preference",
        subject: "coffee",
        claim: "Prefers coffee without sugar.",
        howToApply: "Do not recommend sweet coffee.",
        tags: ["coffee"],
        triggers: ["drink preference"],
        confidence: 1,
      }).success,
    ).toBe(true);
  });
});

function discoverContributions(): Map<string, string> {
  const root = path.resolve("System", "Extensions");
  const contributions = new Map<string, string>();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = path.join(root, entry.name);
    const manifest = AgentSystemExtensionManifestSchema.parse(readJson(path.join(packageRoot, "extension.json")));
    for (const contribution of manifest.contributions) {
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
