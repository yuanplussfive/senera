import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentToolContractBundleLoader } from "../../../Source/AgentSystem/ToolContracts/AgentToolContractBundleLoader.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("tool contract bundle loading", () => {
  test("loads validated contracts as immutable runtime values", () => {
    const root = temporaryPluginRoot();
    writeBundle(root, objectContractSchema());

    const bundle = new AgentToolContractBundleLoader().load(root, "./ToolContracts.json");

    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.tools.ExampleTool?.inputSchema)).toBe(true);
    expect(Object.isFrozen(bundle.tools.ExampleTool?.outputSchema)).toBe(true);
    expect(bundle.tools.ExampleTool?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  test("rejects contract paths outside the plugin root", () => {
    const root = temporaryPluginRoot();

    expect(() => new AgentToolContractBundleLoader().load(root, "../ToolContracts.json")).toThrowError(
      /must stay inside its plugin root/u,
    );
  });

  test("rejects invalid JSON Schema before the plugin enters the registry", () => {
    const root = temporaryPluginRoot();
    writeBundle(root, { type: "not-a-json-schema-type" });

    expect(() => new AgentToolContractBundleLoader().load(root, "./ToolContracts.json")).toThrow();
  });
});

function temporaryPluginRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-tool-contract-"));
  temporaryRoots.push(root);
  return root;
}

function writeBundle(root: string, jsonSchema: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(root, "ToolContracts.json"),
    `${JSON.stringify({
      contractVersion: 1,
      tools: {
        ExampleTool: {
          source: {
            kind: "typescript",
            identity: "./ToolSignature.ts#default",
            file: "./ToolSignature.ts",
            sha256: "0".repeat(64),
          },
          inputSchema: jsonSchema,
          outputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    })}\n`,
    "utf8",
  );
}

function objectContractSchema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}
