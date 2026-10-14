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
  test("publishes configured persona through runtime prompt services", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-persona-runtime-"));
    temporaryRoots.push(workspaceRoot);
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
        Prompt: {
          ...baseConfig.Prompt,
          CorePersona: "可靠的系统助手",
          LanguageStyle: "使用简洁、直接的中文",
        },
      },
    });

    try {
      expect(runtime.services.promptContext.promptPersona()).toEqual({
        enabled: true,
        card: {
          corePersona: "可靠的系统助手",
          languageStyle: "使用简洁、直接的中文",
        },
      });
    } finally {
      await runtime.close();
    }
  });
});
