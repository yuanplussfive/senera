import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export type PluginTomlConfig = TomlTableWithoutBigInt;

export interface ReadPluginTomlConfigOptions {
  cwd?: string;
  exampleFileName?: string;
}

export function resolvePluginConfigPath(
  fileName = "PluginConfig.toml",
  options: ReadPluginTomlConfigOptions = {},
): string {
  return path.isAbsolute(fileName) ? fileName : path.resolve(options.cwd ?? process.cwd(), fileName);
}

export function readPluginTomlConfig<TConfig = PluginTomlConfig>(
  fileName = "PluginConfig.toml",
  options: ReadPluginTomlConfigOptions = {},
): TConfig {
  const configPath = resolvePluginConfigPath(fileName, options);
  if (!fs.existsSync(configPath)) {
    const exampleHint = options.exampleFileName
      ? agentErrorMessage("plugin.configFileMissingHint", {
          exampleFileName: options.exampleFileName,
          configFileName: path.basename(configPath),
        })
      : "";
    throw new Error(
      agentErrorMessage("plugin.configFileMissing", {
        configPath,
        hint: exampleHint,
      }),
    );
  }

  try {
    return parsePluginTomlConfig<TConfig>(fs.readFileSync(configPath, "utf8"));
  } catch (error: unknown) {
    throw new Error(
      agentErrorMessage("plugin.configFileTomlInvalid", {
        configPath,
        message: error instanceof Error ? error.message : String(error),
      }),
      { cause: error },
    );
  }
}

export function parsePluginTomlConfig<TConfig = PluginTomlConfig>(content: string): TConfig {
  return parseToml(content) as TConfig;
}
