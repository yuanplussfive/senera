import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ensureRuntimeConfigFile } from "../../../Apps/RuntimeConfigBootstrap.js";
import { loadConfigFile } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSecretCodec } from "../../../Source/AgentSystem/Config/AgentConfigSecretProtection.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { resolveAgentApplicationPaths } from "../../../Source/AgentSystem/Core/AgentApplicationPaths.js";
import { resolveAgentPromptConfig } from "../../../Source/AgentSystem/Defaults/AgentRuntimeDefaults.js";
import { toAgentSecretKey } from "../../../Source/AgentSystem/Security/AgentSecretKeyRing.js";
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
    const applicationPaths = resolveAgentApplicationPaths(root);
    const secretCodec = new AgentConfigSecretCodec({ workspaceRoot: root, applicationPaths });

    ensureRuntimeConfigFile({ workspaceRoot: root, configPath, templatePath, applicationPaths });
    expect(loadConfigFile(configPath, secretCodec)).toEqual(loadConfigFile(templatePath, secretCodec));
    // The template ships a credential, so the mirror must be sealed with the key this deployment owns.
    const sealedKey = Buffer.from(
      fs.readFileSync(path.join(applicationPaths.secretKeysRoot, "config", "secret.key"), "utf8").trim(),
      "base64url",
    );
    expect(fs.readFileSync(configPath, "utf8")).toContain(`senera:secret:v2:${toAgentSecretKey(sealedKey).id}.`);
    expect(fs.existsSync(resolveAgentWorkspaceLayout(root).configSecretKey)).toBe(false);

    const existing = `${fs.readFileSync(configPath, "utf8")}\n`;
    fs.writeFileSync(configPath, existing, "utf8");
    ensureRuntimeConfigFile({ workspaceRoot: root, configPath, templatePath, applicationPaths });
    expect(fs.readFileSync(configPath, "utf8")).toBe(existing);
  });
});
