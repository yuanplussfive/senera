import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ensureRuntimeConfigFile } from "../../../Apps/RuntimeConfigBootstrap.js";
import { loadConfigFile } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("runtime config bootstrap behavior", () => {
  test("creates a normalized config from the template without replacing an existing file", () => {
    const root = createTemporaryDirectory("senera-runtime-config-bootstrap");
    temporaryDirectories.push(root);
    const configPath = path.join(root, "senera.config.json");
    const templatePath = path.resolve("senera.config.example.json");

    ensureRuntimeConfigFile({ configPath, templatePath });
    expect(loadConfigFile(configPath)).toEqual(loadConfigFile(templatePath));

    const existing = `${fs.readFileSync(configPath, "utf8")}\n`;
    fs.writeFileSync(configPath, existing, "utf8");
    ensureRuntimeConfigFile({ configPath, templatePath });
    expect(fs.readFileSync(configPath, "utf8")).toBe(existing);
  });
});
