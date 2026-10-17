import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSystemRuntime } from "../../../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent persona runtime wiring", () => {
  test("publishes the workspace Markdown prompt through runtime prompt services", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-persona-runtime-"));
    temporaryRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".senera"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "prompts"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".senera", "prompt-preset.json"),
      JSON.stringify({ version: 1, activePath: "prompts/prompt.md" }),
      "utf8",
    );
    fs.writeFileSync(path.join(workspaceRoot, "prompts", "prompt.md"), "# 可靠助手\n\n先给出可验证的结论。", "utf8");
    const baseConfig = JSON.parse(
      fs.readFileSync(path.resolve("senera.config.example.json"), "utf8"),
    ) as AgentSystemConfig;
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot,
      configPath: path.join(workspaceRoot, "senera.config.json"),
      resourcesPath: path.resolve(),
      toolSearchScenarioSource: new VerificationScenarioSource(),
      config: {
        ...baseConfig,
      },
    });

    try {
      expect(runtime.services.promptContext.promptPersona()).toEqual({
        enabled: true,
        card: {
          markdown: "# 可靠助手\n\n先给出可验证的结论。",
          sourcePath: "prompts/prompt.md",
        },
      });
      fs.writeFileSync(path.join(workspaceRoot, "prompts", "prompt.md"), "# 更新后的助手", "utf8");
      expect(runtime.services.promptContext.promptPersona()).toMatchObject({
        enabled: true,
        card: { markdown: "# 更新后的助手", sourcePath: "prompts/prompt.md" },
      });
    } finally {
      await runtime.close();
    }
  });
});
