import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, test } from "vitest";
import {
  createAgentMcpModelConnectionResolver,
  createAgentMcpPackageEndpoint,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageRuntime.js";
import { AgentMcpPackageScanner } from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageScanner.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("declared MCP model connections", () => {
  function config(): AgentSystemConfig {
    const config = JSON.parse(fs.readFileSync("senera.config.example.json", "utf8")) as AgentSystemConfig;
    config.ModelProviderEndpoints = [
      {
        Id: "image-provider",
        BaseUrl: "https://images.example/api",
        ApiKey: "selected-key",
        Headers: { "X-Project": "project" },
      },
    ];
    config.ModelProviders = [
      {
        Id: "image-model",
        ProviderId: "image-provider",
        Endpoint: "ChatCompletions",
        Model: "gpt-image-2",
        Capabilities: { ImageOutput: true },
      },
    ];
    config.DefaultModelProviderId = "image-model";
    return config;
  }

  test("only passes the selected provider connection and retains its configured headers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-model-binding-"));
    const manifest = {
      manifest_version: "0.3",
      name: "model-binding",
      version: "1.0.0",
      server: {
        type: "node",
        entry_point: "server.mjs",
        mcp_config: {
          command: "node",
          args: ["${__dirname}/server.mjs"],
          env: { MODEL_CONNECTION: "${user_config.MODEL}" },
        },
      },
      user_config: {
        MODEL: {
          type: "string",
          title: "Model",
          _meta: {
            "ai.senera/input": { modelSelection: { valueKind: "model-connection", capability: "ImageOutput" } },
          },
        },
      },
    };
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(root, "server.mjs"), "");
    const package_ = new AgentMcpPackageScanner().readPackage(root, "bundled", "model-binding");
    fs.rmSync(root, { recursive: true, force: true });
    const endpoint = createAgentMcpPackageEndpoint(
      package_,
      package_.servers[0]!,
      {
        resolve: (_server, binding) =>
          binding.source === "config" && binding.inputId === "MODEL"
            ? { value: "image-model", source: "configuration" }
            : undefined,
      },
      path.resolve(),
      createAgentMcpModelConnectionResolver(config()),
    );
    expect(endpoint.transport).toBe("stdio");
    if (endpoint.transport !== "stdio") throw new Error("Expected stdio.");
    expect(JSON.parse(endpoint.env!.MODEL_CONNECTION!)).toMatchObject({
      id: "image-model",
      model: "gpt-image-2",
      apiKey: "selected-key",
      baseUrl: "https://images.example/api",
      headers: { "X-Project": "project" },
    });
    expect(endpoint.env).not.toHaveProperty("API_KEY");
  });

  test("rejects unavailable models and models without the declared capability", () => {
    const configuration = config();
    configuration.ModelProviders[0]!.Capabilities = { ImageOutput: false };
    expect(() => createAgentMcpModelConnectionResolver(configuration)("image-model", "ImageOutput")).toThrow(
      "does not declare ImageOutput",
    );
    expect(() => createAgentMcpModelConnectionResolver(configuration)("missing", "ImageOutput")).toThrow();
  });
});
