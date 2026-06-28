import fs from "node:fs";
import path from "node:path";
import { AgentCliDetailMode, type AgentCliDetailMode as AgentCliDetailModeType } from "../Source/AgentSystem/CliDisplay/AgentCliActivity.js";
import { AgentCliPreviewFormatter } from "../Source/AgentSystem/CliDisplay/AgentCliPreviewFormatter.js";
import { AgentConfigLoader } from "../Source/AgentSystem/Config/AgentConfigLoader.js";
import { AgentConfigWatcher } from "../Source/AgentSystem/Config/AgentConfigWatcher.js";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import { resolveAgentDefaults, resolveCliConfig, resolveModelProviderConfig } from "../Source/AgentSystem/AgentDefaults.js";
import type { AgentEventDisplayMode } from "../Source/AgentSystem/CliDisplay/AgentEventDisplayCatalog.js";
import { createSessionId } from "../Source/AgentSystem/Core/AgentIds.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

export type PreviewMode = "block" | "line";

export interface ClientOptions {
  runtimeConfigPath: string;
  url: string;
  sessionId: string;
  showXml: boolean;
  streamXml: boolean;
  eventDisplayMode: AgentEventDisplayMode;
  detailMode: AgentCliDetailModeType;
  livePreview: boolean;
  previewMode: PreviewMode;
  previewTokenLimit: number;
  previewModel: string;
  timeoutMs: number;
  initialInput?: string;
}

export interface CliParseResult {
  options?: ClientOptions;
  helpText?: string;
}

export type CliRuntimeBindings = {
  logger: () => AgentLogger;
  setLogger: (logger: AgentLogger) => void;
  setPreviewFormatter: (formatter: AgentCliPreviewFormatter) => void;
};

const DefaultOptions = {
  runtimeConfigPath: "senera.config.json",
} as const;

export function readOptions(argv: string[]): CliParseResult {
  const runtimeConfigPath = path.resolve(process.cwd(), DefaultOptions.runtimeConfigPath);
  const runtimeConfig = loadRuntimeConfigIfExists(runtimeConfigPath);
  const defaults = resolveAgentDefaults(runtimeConfig);
  const cliConfig = resolveCliConfig(runtimeConfig);
  const parseState: {
    values: Record<string, string | boolean>;
    inputParts: string[];
    invalidOption?: string;
  } = {
    values: {},
    inputParts: [],
  };

  for (let index = 0; index < argv.length && !parseState.invalidOption; index += 1) {
    const token = argv[index];
    const longOption = parseLongOptionToken(token);

    if (!longOption) {
      parseState.invalidOption = token.startsWith("-") ? token : undefined;
      parseState.inputParts = token.startsWith("-")
        ? parseState.inputParts
        : [...parseState.inputParts, token];
      continue;
    }

    if (longOption.kind === "flag") {
      parseState.values[longOption.name] = true;
      continue;
    }

    if (longOption.kind === "pair") {
      parseState.values[longOption.name] = longOption.value;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      parseState.invalidOption = token;
      continue;
    }

    parseState.values[longOption.name] = nextValue;
    index += 1;
  }

  if (parseState.values.help === true) {
    return {
      helpText: renderHelp(),
    };
  }

  if (parseState.invalidOption) {
    return {
      helpText: `${renderHelp()}\n\n无效参数：${parseState.invalidOption}`,
    };
  }

  const previewMode = resolvePreviewMode(cliConfig.Display?.PreviewMode);
  const timeoutMs = resolveTimeoutMsFromSeconds(
    parseState.values.timeout,
    cliConfig.Connection?.TimeoutSeconds,
  );
  const initialInput = cleanCliText(parseState.inputParts.join(" ")).trim();
  const previewModel = readPreviewModel(runtimeConfig);

  return {
    options: {
      runtimeConfigPath,
      url: readStringOption(parseState.values.url)
        || cliConfig.Connection?.Url
        || defaults.Cli.Connection.Url,
      sessionId: readStringOption(parseState.values.sessionId)
        || cliConfig.Connection?.SessionId
        || createSessionId(),
      showXml: cliConfig.Display?.ShowXml ?? false,
      streamXml: cliConfig.Display?.StreamXml ?? false,
      eventDisplayMode: cliConfig.Display?.EventDisplayMode ?? "activity",
      detailMode: resolveDetailMode(cliConfig.Display?.DetailMode),
      livePreview: process.stdout.isTTY && (cliConfig.Display?.LivePreview ?? true),
      previewMode: cliConfig.Display?.PreviewMode ?? previewMode,
      previewTokenLimit: cliConfig.Display?.PreviewTokenLimit ?? defaults.Cli.Display.PreviewTokenLimit,
      previewModel,
      timeoutMs,
      initialInput: initialInput || undefined,
    },
  };
}

export function renderHelp(): string {
  return [
    "senera 持久交互 CLI",
    "",
    "用法:",
    "  npm run cli",
    "  npm run cli -- --session-id=my_session",
    "  npm run cli -- \"今天北京和广州天气怎么样了\"",
    "",
    "输入命令:",
    "  /exit                退出 CLI",
    "  /new                 创建新会话并切换",
    "  /session             显示当前会话信息",
    "  /close               关闭当前会话并退出",
    "",
    "参数:",
    "  --url=WS_URL           WebSocket 地址，默认 ws://127.0.0.1:8787",
    "  --session-id=ID        指定或恢复会话 ID",
    "  --timeout=SECONDS      单次请求超时秒数，默认 180",
    "  --help                 显示帮助",
    "",
    "展示相关配置请修改 senera.config.json 的 Cli 字段",
  ].join("\n");
}

export function startCliConfigWatcher(
  options: ClientOptions,
  bindings: CliRuntimeBindings,
): AgentConfigWatcher | undefined {
  if (!fs.existsSync(options.runtimeConfigPath)) {
    return undefined;
  }

  let watcher: AgentConfigWatcher;
  watcher = new AgentConfigWatcher({
    configPath: options.runtimeConfigPath,
    enabled: true,
    onEvent: async (event) => {
      if (event.kind === AgentEventKinds.ConfigReloaded) {
        applyCliRuntimeConfig(options, watcher.snapshot().value, bindings);
        bindings.logger().info("CLI 配置已热更新", {
          configPath: options.runtimeConfigPath,
        });
        return;
      }

      if (event.kind === AgentEventKinds.ConfigFailed) {
        bindings.logger().warn("CLI 配置热更新失败", {
          configPath: options.runtimeConfigPath,
          message: String(event.data.message),
        });
      }
    },
  });
  watcher.start();
  return watcher;
}

export function applyCliRuntimeConfig(
  options: ClientOptions,
  runtimeConfig: AgentSystemConfig,
  bindings: CliRuntimeBindings,
): void {
  const defaults = resolveAgentDefaults(runtimeConfig);
  const cliConfig = resolveCliConfig(runtimeConfig);
  const nextPreviewModel = readPreviewModel(runtimeConfig);

  options.showXml = cliConfig.Display?.ShowXml ?? false;
  options.streamXml = cliConfig.Display?.StreamXml ?? false;
  options.eventDisplayMode = cliConfig.Display?.EventDisplayMode ?? "activity";
  options.detailMode = resolveDetailMode(cliConfig.Display?.DetailMode);
  options.livePreview = process.stdout.isTTY && (cliConfig.Display?.LivePreview ?? true);
  options.previewMode = cliConfig.Display?.PreviewMode ?? resolvePreviewMode(undefined);
  options.previewTokenLimit =
    cliConfig.Display?.PreviewTokenLimit ?? defaults.Cli.Display.PreviewTokenLimit;
  options.previewModel = nextPreviewModel;
  options.timeoutMs = secondsToMilliseconds(
    cliConfig.Connection?.TimeoutSeconds ?? defaults.Cli.Connection.TimeoutSeconds,
  );

  bindings.setLogger(new AgentLogger({
    eventDisplayMode: options.eventDisplayMode,
  }));
  bindings.setPreviewFormatter(new AgentCliPreviewFormatter({
    model: options.previewModel,
    tokenLimit: options.previewTokenLimit,
  }));
}

export function readPreviewModel(config: AgentSystemConfig | undefined): string {
  return config
    ? resolveModelProviderConfig(config).Model
    : resolveAgentDefaults(undefined).ModelRuntime.Model;
}

function parseLongOptionToken(token: string): (
  | { kind: "flag"; name: string }
  | { kind: "pair"; name: string; value: string }
  | { kind: "pending"; name: string }
  | undefined
) {
  if (!token.startsWith("--")) {
    return undefined;
  }

  const normalized = token.slice(2);
  const equalIndex = normalized.indexOf("=");
  const name = equalIndex >= 0 ? normalized.slice(0, equalIndex) : normalized;
  const value = equalIndex >= 0 ? normalized.slice(equalIndex + 1) : undefined;
  const flag = (optionName: string) => ({ kind: "flag" as const, name: optionName });
  const pair = (optionName: string, optionValue: string) => ({
    kind: "pair" as const,
    name: optionName,
    value: optionValue,
  });
  const pending = (optionName: string) => ({ kind: "pending" as const, name: optionName });

  return ({
    help: flag("help"),
    url: value !== undefined ? pair("url", value) : pending("url"),
    "session-id": value !== undefined ? pair("sessionId", value) : pending("sessionId"),
    timeout: value !== undefined ? pair("timeout", value) : pending("timeout"),
  })[name];
}

function readStringOption(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function resolvePreviewMode(value: string | boolean | undefined): PreviewMode {
  return value === "block" || value === "line"
    ? value
    : process.platform === "win32" || (process.stdout.columns ?? 0) < 96
      ? "line"
      : "block";
}

function resolveTimeoutMsFromSeconds(value: string | boolean | undefined, defaultValue: number | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  const seconds = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : defaultValue ?? resolveAgentDefaults(undefined).Cli.Connection.TimeoutSeconds;
  return secondsToMilliseconds(seconds);
}

function secondsToMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000);
}

function resolveDetailMode(value: string | boolean | undefined): AgentCliDetailModeType {
  return ({
    none: AgentCliDetailMode.None,
    errors: AgentCliDetailMode.Errors,
    tools: AgentCliDetailMode.Tools,
    xml: AgentCliDetailMode.Xml,
    all: AgentCliDetailMode.All,
  })[typeof value === "string" ? value.trim().toLowerCase() : ""] ?? AgentCliDetailMode.None;
}

function loadRuntimeConfigIfExists(configPath: string): AgentSystemConfig | undefined {
  return fs.existsSync(configPath)
    ? AgentConfigLoader.load(configPath)
    : undefined;
}

function cleanCliText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
