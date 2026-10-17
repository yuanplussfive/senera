import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ensureRuntimeConfigFile } from "../../../Apps/RuntimeConfigBootstrap.js";
import { loadConfigFile } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSecretCodec } from "../../../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { resolveAgentPromptConfig } from "../../../Source/AgentSystem/Defaults/AgentRuntimeDefaults.js";
import { DefaultAgentTimeZone } from "../../../Source/AgentSystem/Time/AgentTime.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("runtime config bootstrap behavior", () => {
  test("uses the shared time-zone default when configuration is blank", () => {
    expect(resolveAgentPromptConfig({ ModelProviders: [], Prompt: { TimeZone: "   " } }).TimeZone).toBe(
      DefaultAgentTimeZone,
    );
  });

  test("rejects an unsupported time zone at the configuration boundary", () => {
    expect(
      AgentSystemConfigSchema.safeParse({ ModelProviders: [], Prompt: { TimeZone: "China Standard Time" } }).success,
    ).toBe(false);
  });

  test("creates a normalized config from the template without replacing an existing file", () => {
    const root = createTemporaryDirectory("senera-runtime-config-bootstrap");
    temporaryDirectories.push(root);
    const configPath = path.join(root, "senera.config.json");
    const templatePath = path.resolve("senera.config.example.json");
    const secretCodec = new AgentConfigSecretCodec({ workspaceRoot: root });

    ensureRuntimeConfigFile({ workspaceRoot: root, configPath, templatePath });
    expect(loadConfigFile(configPath, secretCodec)).toEqual(loadConfigFile(templatePath, secretCodec));

    const existing = `${fs.readFileSync(configPath, "utf8")}\n`;
    fs.writeFileSync(configPath, existing, "utf8");
    ensureRuntimeConfigFile({ workspaceRoot: root, configPath, templatePath });
    expect(fs.readFileSync(configPath, "utf8")).toBe(existing);
  });
});
