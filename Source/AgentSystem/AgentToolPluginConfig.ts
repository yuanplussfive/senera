import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, type TomlTableWithoutBigInt } from "smol-toml";

export type PluginTomlConfig = TomlTableWithoutBigInt;

export interface ReadPluginTomlConfigOptions {
  cwd?: string;
  exampleFileName?: string;
}

export function resolvePluginConfigPath(
  fileName = "PluginConfig.toml",
  options: ReadPluginTomlConfigOptions = {},
): string {
  return path.isAbsolute(fileName)
    ? fileName
    : path.resolve(options.cwd ?? process.cwd(), fileName);
}

export function readPluginTomlConfig<TConfig = PluginTomlConfig>(
  fileName = "PluginConfig.toml",
  options: ReadPluginTomlConfigOptions = {},
): TConfig {
  const configPath = resolvePluginConfigPath(fileName, options);
  if (!fs.existsSync(configPath)) {
    const exampleHint = options.exampleFileName
      ? ` 请复制 ${options.exampleFileName} 为 ${path.basename(configPath)} 后填写配置。`
      : "";
    throw new Error(`缺少插件配置文件：${configPath}。${exampleHint}`);
  }

  try {
    return parsePluginTomlConfig<TConfig>(fs.readFileSync(configPath, "utf8"));
  } catch (error: unknown) {
    throw new Error(
      `插件配置文件 TOML 格式错误：${configPath}：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function parsePluginTomlConfig<TConfig = PluginTomlConfig>(
  content: string,
): TConfig {
  return parseToml(content) as TConfig;
}
