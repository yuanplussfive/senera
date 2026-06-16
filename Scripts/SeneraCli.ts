import * as readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
import { AgentCliDetailMode, type AgentCliDetailMode as AgentCliDetailModeType } from "../Source/AgentSystem/AgentCliActivity.js";
import { AgentCliPreviewFormatter } from "../Source/AgentSystem/AgentCliPreviewFormatter.js";
import { AgentConfigLoader } from "../Source/AgentSystem/AgentConfigLoader.js";
import { AgentConfigWatcher } from "../Source/AgentSystem/AgentConfigWatcher.js";
import { AgentConsoleTheme } from "../Source/AgentSystem/AgentConsoleTheme.js";
import { AgentEventChannels, AgentEventKinds, type AgentEventEnvelope } from "../Source/AgentSystem/AgentEvent.js";
import { resolveAgentDefaults, resolveCliConfig, resolveModelProviderConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { type AgentEventDisplayMode } from "../Source/AgentSystem/AgentEventDisplayCatalog.js";
import { createSessionId, describeSessionHandle } from "../Source/AgentSystem/AgentIds.js";
import { AgentLogger } from "../Source/AgentSystem/AgentLogger.js";
import { fitTerminalLine, measureTerminalWidth } from "../Source/AgentSystem/AgentTerminalText.js";
import { readXmlRootName } from "../Source/AgentSystem/AgentXmlRootReader.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types.js";

type PreviewMode = "block" | "line";

interface ClientOptions {
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

interface CliParseResult {
  options?: ClientOptions;
  helpText?: string;
}

interface PendingRequest {
  requestId: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
  input: string;
}

const DefaultOptions = {
  runtimeConfigPath: "senera.config.json",
} as const;

let logger = new AgentLogger();
const decisionXmlByStep = new Map<number, string>();
const decisionXmlByDetailId = new Map<string, { xml: string; rawXml?: string; sanitized: boolean }>();
const pendingDecisionXmlSummaryByDetailId = new Map<string, AgentEventEnvelope<string, unknown>>();
let currentClientOptions: ClientOptions | undefined;
let currentPreviewFormatter: AgentCliPreviewFormatter | undefined;

void main().catch((error) => {
  process.exitCode = 1;
  logger.error(error instanceof Error ? error.message : String(error));
});

async function main(): Promise<void> {
  const cli = readOptions(process.argv.slice(2));
  if (cli.helpText) {
    process.stdout.write(`${cli.helpText}\n`);
    return;
  }

  const options = cli.options;
  if (!options) {
    process.exitCode = 1;
    return;
  }

  logger = new AgentLogger({
    eventDisplayMode: options.eventDisplayMode,
  });
  currentPreviewFormatter = new AgentCliPreviewFormatter({
    model: options.previewModel,
    tokenLimit: options.previewTokenLimit,
  });
  currentClientOptions = options;
  await runInteractiveClient(options);
}

function readOptions(argv: string[]): CliParseResult {
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
  const timeoutMs = resolveTimeoutMs(
    parseState.values.timeout,
    cliConfig.Connection?.TimeoutMs,
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

function renderHelp(): string {
  return [
    "senera 持久交互 CLI",
    "",
    "用法:",
    "  node Dist/Scripts/SeneraCli.js",
    "  node Dist/Scripts/SeneraCli.js --session-id=my_session",
    "  node Dist/Scripts/SeneraCli.js \"今天北京和广州天气怎么样了\"",
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
    "  --timeout=MS           单次请求超时毫秒数，默认 180000",
    "  --help                 显示帮助",
    "",
    "展示相关配置请修改 senera.config.json 的 Cli 字段",
  ].join("\n");
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

async function runInteractiveClient(options: ClientOptions): Promise<void> {
  const socket = await openSocket(options.url);
  const configWatcher = startCliConfigWatcher(options);
  const state = {
    sessionId: options.sessionId,
    pendingRequest: undefined as PendingRequest | undefined,
    closing: false,
    awaitingSessionReady: true,
    promptOnSessionReady: !options.initialInput,
  };
  const lifecycle = {
    shutdownRequested: false,
    readlineClosed: false,
    socketCloseRequested: false,
    socketClosed: false,
  };

  logger.banner("senera 持久交互 CLI", {
    url: options.url,
    sessionId: state.sessionId,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: buildPrompt(state.sessionId),
  });

  const clearPendingRequest = () => {
    clearPending(state.pendingRequest);
    state.pendingRequest = undefined;
  };

  const closeReadline = () => {
    if (lifecycle.readlineClosed) {
      return;
    }

    lifecycle.readlineClosed = true;
    rl.close();
  };

  const closeSocket = () => {
    if (lifecycle.socketClosed || lifecycle.socketCloseRequested || socket.readyState >= socket.CLOSING) {
      return;
    }

    lifecycle.socketCloseRequested = true;
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      socket.close();
    }
  };

  const requestShutdown = () => {
    if (lifecycle.shutdownRequested) {
      return;
    }

    lifecycle.shutdownRequested = true;
    configWatcher?.stop();
    clearPendingRequest();
    closeReadline();
    closeSocket();
  };

  const promptIfInteractive = () => {
    if (lifecycle.shutdownRequested || lifecycle.readlineClosed || lifecycle.socketClosed || state.closing) {
      return;
    }

    rl.prompt();
  };

  socket.on("message", (data) => {
    if (lifecycle.shutdownRequested) {
      return;
    }

    const event = parseEvent(data.toString("utf8"));
    const terminalReached = printEvent(event, options, state);
    if (isSessionReadyEvent(event, state)) {
      state.awaitingSessionReady = false;
      if (state.promptOnSessionReady && !state.pendingRequest) {
        state.promptOnSessionReady = false;
        promptIfInteractive();
      }
    }
    if (terminalReached) {
      clearPendingRequest();
      promptIfInteractive();
    }
  });

  socket.on("error", (error) => {
    if (lifecycle.shutdownRequested) {
      return;
    }

    logger.error("WS 错误", {
      message: error.message,
    });
    requestShutdown();
  });

  socket.on("close", () => {
    lifecycle.socketClosed = true;
    clearPendingRequest();
    logger.info("WS 已关闭");
    if (!state.closing) {
      process.exitCode = 1;
    }
    closeReadline();
  });

  await sendJson(socket, {
    type: "session.create",
    sessionId: state.sessionId,
  });

  rl.on("line", async (line) => {
    const input = cleanCliText(line).trim();
    if (input.length === 0) {
      promptIfInteractive();
      return;
    }

    const commandHandled = await handleLocalCommand(input, socket, options, state, rl);
    if (commandHandled) {
      return;
    }

    if (state.pendingRequest) {
      logger.warn("当前仍有请求在处理中", {
        requestId: state.pendingRequest.requestId,
      });
      promptIfInteractive();
      return;
    }

    const requestId = `cli_${Date.now()}`;
    const timeout = setTimeout(() => {
      if (lifecycle.shutdownRequested) {
        return;
      }

      logger.error("请求超时", {
        requestId,
        timeoutMs: options.timeoutMs,
      });
      clearPendingRequest();
      promptIfInteractive();
    }, options.timeoutMs);

    state.pendingRequest = {
      requestId,
      input,
      startedAt: Date.now(),
      timeout,
    };

    decisionXmlByStep.clear();
    decisionXmlByDetailId.clear();
    pendingDecisionXmlSummaryByDetailId.clear();
    printUserRequest(input);

    await sendJson(socket, {
      type: "session.message",
      sessionId: state.sessionId,
      requestId,
      input,
    });
  });

  rl.on("close", () => {
    state.closing = true;
    requestShutdown();
  });

  if (options.initialInput) {
    rl.write(options.initialInput);
    rl.write(null, { name: "return" });
  }
}

async function handleLocalCommand(
  input: string,
  socket: WebSocket,
  options: ClientOptions,
  state: {
    sessionId: string;
    pendingRequest?: PendingRequest;
    closing: boolean;
    awaitingSessionReady: boolean;
    promptOnSessionReady: boolean;
  },
  rl: readline.Interface,
): Promise<boolean> {
  const command = input.toLowerCase();
  const handlers: Partial<Record<string, () => Promise<boolean>>> = {
    "/exit": async () => {
      state.closing = true;
      rl.close();
      return true;
    },
    "/session": async () => {
      logger.info("当前会话", {
        sessionId: state.sessionId,
        busy: Boolean(state.pendingRequest),
      });
      rl.prompt();
      return true;
    },
    "/new": async () => {
      if (state.pendingRequest) {
        logger.warn("当前仍有请求在处理中", {
          requestId: state.pendingRequest.requestId,
        });
        rl.prompt();
        return true;
      }

      state.sessionId = createSessionId();
      rl.setPrompt(buildPrompt(state.sessionId));
      state.awaitingSessionReady = true;
      state.promptOnSessionReady = true;
      logger.info("切换到新会话", {
        sessionId: state.sessionId,
      });
      await sendJson(socket, {
        type: "session.create",
        sessionId: state.sessionId,
      });
      return true;
    },
    "/close": async () => {
      if (state.pendingRequest) {
        logger.warn("当前仍有请求在处理中", {
          requestId: state.pendingRequest.requestId,
        });
        rl.prompt();
        return true;
      }

      state.closing = true;
      await sendJson(socket, {
        type: "session.close",
        sessionId: state.sessionId,
      });
      rl.close();
      return true;
    },
  };

  return handlers[command]?.() ?? false;
}

function buildPrompt(sessionId: string): string {
  return AgentConsoleTheme.brand(`${describeSessionHandle(sessionId)}> `);
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function sendJson(socket: WebSocket, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(JSON.stringify(payload), (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function clearPending(pending: PendingRequest | undefined): void {
  if (pending) {
    clearTimeout(pending.timeout);
  }
}

function loadRuntimeConfigIfExists(configPath: string): AgentSystemConfig | undefined {
  return fs.existsSync(configPath)
    ? AgentConfigLoader.load(configPath)
    : undefined;
}

function startCliConfigWatcher(options: ClientOptions): AgentConfigWatcher | undefined {
  if (!fs.existsSync(options.runtimeConfigPath)) {
    return undefined;
  }

  let watcher: AgentConfigWatcher;
  watcher = new AgentConfigWatcher({
    configPath: options.runtimeConfigPath,
    enabled: true,
    onEvent: async (event) => {
      if (event.kind === AgentEventKinds.ConfigReloaded) {
        applyCliRuntimeConfig(options, watcher.snapshot().value);
        logger.info("CLI 配置已热更新", {
          configPath: options.runtimeConfigPath,
        });
        return;
      }

      if (event.kind === AgentEventKinds.ConfigFailed) {
        logger.warn("CLI 配置热更新失败", {
          configPath: options.runtimeConfigPath,
          message: String(event.data.message),
        });
      }
    },
  });
  watcher.start();
  return watcher;
}

function applyCliRuntimeConfig(options: ClientOptions, runtimeConfig: AgentSystemConfig): void {
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
  options.timeoutMs = cliConfig.Connection?.TimeoutMs ?? defaults.Cli.Connection.TimeoutMs;

  logger = new AgentLogger({
    eventDisplayMode: options.eventDisplayMode,
  });
  currentPreviewFormatter = new AgentCliPreviewFormatter({
    model: options.previewModel,
    tokenLimit: options.previewTokenLimit,
  });
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

function resolveTimeoutMs(value: string | boolean | undefined, defaultValue: number | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : defaultValue ?? resolveAgentDefaults(undefined).Cli.Connection.TimeoutMs;
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

function parseEvent(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {
      type: "raw",
      text,
    };
  }
}

function printEvent(
  event: unknown,
  options: ClientOptions,
  state: {
    sessionId: string;
    pendingRequest?: PendingRequest;
    closing: boolean;
    awaitingSessionReady: boolean;
    promptOnSessionReady: boolean;
  },
): boolean {
  if (!isEventEnvelope(event)) {
    logger.block("unknown", event);
    return false;
  }

  if (options.eventDisplayMode === "activity") {
    return printActivityEvent(event, options, state);
  }

  const envelope = event;
  const kind = envelope.kind;
  const data = normalizeRecord(envelope.data);

  const printers: Record<string, () => void> = {
    "session.created": () => logger.event(envelope),
    "session.snapshot": () => logger.event(envelope),
    "session.closed": () => logger.event(envelope),
    "session.busy": () => logger.tree("session.busy", data, AgentConsoleTheme.warning),
    "session.not_found": () => logger.tree("session.not_found", data, AgentConsoleTheme.error),
    "model.delta": () => {
      if (options.streamXml && !options.livePreview) {
        logger.raw(String(data.text ?? ""));
      }
    },
    "model.stream.opened": () => undefined,
    "model.stream.aborted": () => printModelStreamAborted(envelope),
    "model.completed": () => undefined,
    "decision.xml.progress": () => printDecisionXmlPreview(envelope, options),
    "decision.xml.ready": () => undefined,
    "decision.xml.limit_reached": () => logger.tree("decision.xml.limit_reached", data, AgentConsoleTheme.error),
    "decision.xml.summary": () => printDecisionXmlSummary(envelope, options),
    "decision.xml.detail": () => cacheDecisionXmlDetail(envelope),
    "decision.parsed": () => printParsedDecision(envelope),
    "decision.parsed.detail": () => undefined,
    "retry.planned": () => printRetryPlanned(envelope),
    "retry.detail": () => printRetryDetail(envelope),
    "tool.results": () => printToolResultsSummary(envelope),
    "tool.results.detail": () => printToolResultsDetail(envelope, options),
    "final.answer": () => logger.block("final.answer", data.content ?? "", AgentConsoleTheme.success),
    "ask.user": () => logger.block("ask.user", data.question ?? "", AgentConsoleTheme.warning),
    "run.failed": () => logger.tree("run.failed", data, AgentConsoleTheme.error),
    "request.invalid": () => logger.block("request.invalid", data, AgentConsoleTheme.error),
  };

  const printer = printers[kind] ?? (() => logger.event(envelope));
  printer();

  return isTerminalEvent(envelope)
    && (!state.pendingRequest || envelope.requestId === state.pendingRequest.requestId);
}

function printActivityEvent(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
  state: {
    sessionId: string;
    pendingRequest?: PendingRequest;
    closing: boolean;
    awaitingSessionReady: boolean;
    promptOnSessionReady: boolean;
  },
): boolean {
  const kind = envelope.kind;
  const data = normalizeRecord(envelope.data);

  if (kind === "model.delta" && options.streamXml && !options.livePreview) {
    logger.raw(String(data.text ?? ""));
    return false;
  }

  cacheActivitySideData(envelope);
  const printers: Record<string, () => void> = {
    "session.created": () => logger.event(envelope),
    "session.snapshot": () => logger.event(envelope),
    "session.closed": () => logger.event(envelope),
    "session.busy": () => logger.tree("session.busy", data, AgentConsoleTheme.warning),
    "session.not_found": () => logger.tree("session.not_found", data, AgentConsoleTheme.error),
    "run.started": () => logger.event(envelope),
    "prompt.summary": () => logger.event(envelope),
    "prompt.rendered": () => logger.event(envelope),
    "model.started": () => logger.event(envelope),
    "model.stream.opened": () => logger.event(envelope),
    "model.delta": () => undefined,
    "model.completed": () => undefined,
    "model.stream.aborted": () => printModelStreamAborted(envelope),
    "decision.xml.progress": () => printDecisionXmlPreview(envelope, options),
    "decision.xml.ready": () => logger.event(envelope),
    "decision.xml.limit_reached": () => logger.tree("decision.xml.limit_reached", data, AgentConsoleTheme.error),
    "decision.xml.summary": () => options.showXml ? printDecisionXmlSummary(envelope, options) : undefined,
    "decision.xml.detail": () => undefined,
    "decision.parsed": () => printParsedDecision(envelope),
    "decision.parsed.detail": () => printToolCallPreviews(envelope, options),
    "retry.planned": () => printRetryPlanned(envelope),
    "retry.detail": () => shouldRenderErrorDetails(options) || options.showXml ? printRetryDetail(envelope) : undefined,
    "tool.calls.planned": () => logger.event(envelope),
    "tool.call.started": () => logger.event(envelope),
    "tool.call.completed": () => logger.event(envelope),
    "tool.call.failed": () => logger.tree("tool.call.failed", previewStructuredRecord(data), AgentConsoleTheme.error),
    "tool.results": () => logger.event(envelope),
    "tool.results.detail": () => printToolResultPreviews(envelope, options),
    "final.answer": () => logger.block("final.answer", data.content ?? "", AgentConsoleTheme.success),
    "ask.user": () => logger.block("ask.user", data.question ?? "", AgentConsoleTheme.warning),
    "run.failed": () => logger.tree("run.failed", data, AgentConsoleTheme.error),
    "run.completed": () => logger.event(envelope),
    "request.invalid": () => logger.block("request.invalid", data, AgentConsoleTheme.error),
  };

  (printers[kind] ?? (() => logger.event(envelope)))();

  const terminalMatched = isTerminalEvent(envelope)
    && (!state.pendingRequest || envelope.requestId === state.pendingRequest.requestId);

  return terminalMatched;
}

function cacheActivitySideData(envelope: AgentEventEnvelope<string, unknown>): void {
  if (envelope.kind === "decision.xml.detail") {
    cacheDecisionXmlDetail(envelope);
    return;
  }

  if (envelope.kind === "decision.xml.summary") {
    cacheDecisionXmlSummary(envelope);
  }
}

function isSessionReadyEvent(
  event: unknown,
  state: {
    sessionId: string;
    awaitingSessionReady: boolean;
  },
): boolean {
  if (!state.awaitingSessionReady || !isEventEnvelope(event)) {
    return false;
  }

  return (
    (event.kind === "session.created" || event.kind === "session.snapshot")
    && event.sessionId === state.sessionId
  );
}

function printDecisionXmlPreview(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
): void {
  if (!options.livePreview) {
    return;
  }

  const data = normalizeRecord(envelope.data);
  const preview = buildDecisionXmlPreview(envelope, data, options.previewMode);
  return options.previewMode === "block"
    ? logger.replaceBlock("xml.preview", preview.block, previewColor(String(data.state ?? "collecting")))
    : logger.replaceLine("xml.preview", preview.line, previewColor(String(data.state ?? "collecting")));
}

function cacheDecisionXmlSummary(envelope: AgentEventEnvelope<string, unknown>): void {
  const step = Number(envelope.step);
  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  const cached = detailId.length > 0 ? decisionXmlByDetailId.get(detailId) : undefined;
  const xml = cached?.xml ?? "";
  if (Number.isFinite(step) && xml.length > 0) {
    decisionXmlByStep.set(step, xml);
  }
}

function cacheDecisionXmlDetail(envelope: AgentEventEnvelope<string, unknown>): void {
  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  if (detailId.length === 0) {
    return;
  }

  decisionXmlByDetailId.set(detailId, {
    xml: String(data.xml ?? ""),
    rawXml: typeof data.rawXml === "string" ? data.rawXml : undefined,
    sanitized: Boolean(data.sanitized),
  });

  const pending = pendingDecisionXmlSummaryByDetailId.get(detailId);
  if (pending && currentClientOptions) {
    pendingDecisionXmlSummaryByDetailId.delete(detailId);
    printDecisionXmlSummary(pending, currentClientOptions);
  }
}

function printDecisionXmlSummary(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
): void {
  cacheDecisionXmlSummary(envelope);
  if (!options.showXml) {
    return;
  }

  const data = normalizeRecord(envelope.data);
  const detailId = String(data.detailId ?? "");
  const cached = decisionXmlByDetailId.get(detailId);
  if (!cached) {
    pendingDecisionXmlSummaryByDetailId.set(detailId, envelope);
    return;
  }

  logger.block(
    cached.sanitized ? "decision.xml.sanitized" : "decision.xml",
    cached.xml,
    AgentConsoleTheme.xml,
  );

  if (cached.sanitized && cached.rawXml) {
    logger.block("decision.xml.raw", cached.rawXml, AgentConsoleTheme.frame);
  }
}

function printParsedDecision(envelope: AgentEventEnvelope<string, unknown>): void {
  const data = normalizeRecord(envelope.data);
  logger.tree(
    "decision.parsed",
    {
      step: envelope.step,
      decisionKind: data.decisionKind,
      root: data.root,
      detailId: data.detailId,
    },
    AgentConsoleTheme.action,
  );
}

function printRetryPlanned(envelope: AgentEventEnvelope<string, unknown>): void {
  logger.event(envelope);
  logger.tree("retry.planned", previewStructuredRecord(envelope.data), AgentConsoleTheme.retry);
}

function printRetryDetail(envelope: AgentEventEnvelope<string, unknown>): void {
  const data = normalizeRecord(envelope.data);
  const instruction = normalizeRecord(data.instruction);
  logger.tree(
    "retry.detail",
    previewStructuredRecord(pick(instruction, ["code", "message", "retryable", "details"])),
    AgentConsoleTheme.retry,
  );

  const diagnostics = instruction.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    logger.tree("retry.diagnostics", previewStructuredValue(diagnostics), AgentConsoleTheme.error);
  }

  const repairPrompt = instruction.repairPrompt;
  if (typeof repairPrompt === "string" && repairPrompt.length > 0) {
    logger.block("retry.repair_prompt", previewFormatter().previewText(repairPrompt), AgentConsoleTheme.retry);
  }

  const step = Number(envelope.step);
  const xml = decisionXmlByStep.get(step);
  if (xml) {
    logger.block("decision.xml 需要修复", xml, AgentConsoleTheme.xml);
  }
}

function printToolResultsSummary(envelope: AgentEventEnvelope<string, unknown>): void {
  logger.event(envelope);
  logger.tree("tool.results", previewStructuredRecord(envelope.data), AgentConsoleTheme.tool);
}

function printToolResultsDetail(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
): void {
  const data = normalizeRecord(envelope.data);
  logger.tree("tool.results.detail", data.value, AgentConsoleTheme.tool);

  if (options.showXml) {
    logger.block("tool.results.xml", data.xml ?? "", AgentConsoleTheme.xml);
  }
}

function printUserRequest(input: string): void {
  logger.block(
    "user.request",
    previewFormatter().previewText(input),
    AgentConsoleTheme.brand,
  );
}

function printToolCallPreviews(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
): void {
  if (!shouldRenderToolDetails(options)) {
    return;
  }

  const payload = normalizeRecord(normalizeRecord(envelope.data).payload);
  const calls = Array.isArray(payload.tool_call) ? payload.tool_call : [];

  calls
    .map((entry) => normalizeRecord(entry))
    .forEach((call, index) => {
      logger.tree(
        "tool.call",
        buildToolCallTree({
          step: envelope.step,
          index: index + 1,
          name: call.name,
          arguments: call.arguments ?? {},
        }),
        AgentConsoleTheme.tool,
      );
    });
}

function printToolResultPreviews(
  envelope: AgentEventEnvelope<string, unknown>,
  options: ClientOptions,
): void {
  const data = normalizeRecord(envelope.data);
  const value = Array.isArray(data.value) ? data.value : [];

  if (shouldRenderToolDetails(options)) {
    value
      .map((entry) => normalizeRecord(entry))
      .forEach((entry, index) => {
        logger.tree(
          "tool.result",
          buildToolResultTree({
            step: envelope.step,
            index: index + 1,
            entry,
          }),
          AgentConsoleTheme.tool,
        );
      });
  }

  if (options.showXml) {
    logger.block("tool.results.xml", data.xml ?? "", AgentConsoleTheme.xml);
  }
}

function printModelStreamAborted(envelope: AgentEventEnvelope<string, unknown>): void {
  const reason = String(normalizeRecord(envelope.data).reason ?? "");
  if (reason === "xml_root_closed") {
    return;
  }

  logger.event(envelope);
}

function buildDecisionXmlPreview(
  envelope: AgentEventEnvelope<string, unknown>,
  data: Record<string, unknown>,
  mode: PreviewMode,
): { line: string; block: string } {
  const xml = String(data.xml ?? "");
  const state = String(data.state ?? "collecting");
  const step = Number(envelope.step);
  const lineCount = countLines(xml);
  const line = fitPreviewLine([
    `step=${Number.isFinite(step) ? step : "?"}`,
    `state=${state}`,
    `chars=${xml.length}`,
    `lines=${lineCount}`,
    rootSummary(xml),
    lineTailSummary(xml),
  ].filter((item) => item.length > 0).join("  "));
  const block = [
    fitPreviewLine([
      `step=${Number.isFinite(step) ? step : "?"}`,
      `state=${state}`,
      `chars=${xml.length}`,
      `lines=${lineCount}`,
      rootSummary(xml),
      tailSummary(xml),
    ].filter((item) => item.length > 0).join("  ")),
    ...previewXmlLines(xml, mode),
  ].join("\n");

  return {
    line,
    block,
  };
}

function previewXmlLines(xml: string, mode: PreviewMode): string[] {
  const lines = xml.length > 0 ? xml.replace(/\r/g, "").split("\n") : ["(waiting for XML content)"];
  const visibleWindow = mode === "block" ? 4 : 1;
  const hiddenCount = Math.max(lines.length - visibleWindow, 0);
  const windowLines = lines.slice(-visibleWindow);
  const fittedLines = windowLines.map((line) => fitPreviewLine(line));
  const fillerCount = Math.max(visibleWindow - fittedLines.length, 0);

  return [
    hiddenCount > 0 ? fitPreviewLine(`... ${hiddenCount} earlier lines hidden ...`) : fitPreviewLine(""),
    ...Array.from({ length: fillerCount }, () => fitPreviewLine("")),
    ...fittedLines,
  ];
}

function fitPreviewLine(line: string): string {
  return fitTerminalLine(line, previewWidth());
}

function previewWidth(): number {
  return Math.max((process.stdout.columns ?? 120) - 8, 36);
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r?\n/).length;
}

function buildToolCallTree(input: {
  step: number | undefined;
  index: number;
  name: unknown;
  arguments: unknown;
}): Record<string, unknown> {
  return {
    step: input.step,
    index: input.index,
    name: input.name,
    arguments: previewFormatter().previewStructuredValue(input.arguments),
  };
}

function buildToolResultTree(input: {
  step: number | undefined;
  index: number;
  entry: Record<string, unknown>;
}): Record<string, unknown> {
  const runtime = normalizeRecord(input.entry.runtime);
  const request = normalizeRecord(input.entry.request);
  const response = normalizeRecord(input.entry.response);

  return {
    step: input.step,
    index: input.index,
    call_id: previewFormatter().previewValue(input.entry.callId ?? runtime.call_id ?? ""),
    name: previewFormatter().previewValue(input.entry.name ?? ""),
    request: previewFormatter().previewStructuredValue(
      request.arguments ?? input.entry.arguments ?? {},
    ),
    response: previewFormatter().previewStructuredValue(
      response.result ?? input.entry.result ?? {},
    ),
  };
}

function previewColor(state: string): (value: string) => string {
  return ({
    collecting: AgentConsoleTheme.xml,
    root_closed: AgentConsoleTheme.success,
    invalid: AgentConsoleTheme.warning,
  })[state] ?? AgentConsoleTheme.xml;
}

function rootSummary(xml: string): string {
  const root = readXmlRootName(xml);
  return root ? `root=${root}` : "";
}

function tailSummary(xml: string): string {
  const compact = xml.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? `tail=${fitPreviewLine(compact)}` : "";
}

function lineTailSummary(xml: string): string {
  const compact = xml.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "preview=(waiting for XML content)";
  }

  const tailWindow = Math.max(Math.floor(previewWidth() * 0.55), 24);
  const tail = measureTerminalWidth(compact) <= tailWindow
    ? compact
    : takeTerminalTail(compact, tailWindow);

  return `preview=${tail}`;
}

function takeTerminalTail(value: string, width: number): string {
  const symbols = Array.from(value);
  let consumed = 0;
  let output = "";

  for (let index = symbols.length - 1; index >= 0; index -= 1) {
    const symbol = symbols[index];
    const symbolWidth = measureTerminalWidth(symbol);
    if (consumed + symbolWidth > Math.max(width - 3, 0)) {
      break;
    }

    output = `${symbol}${output}`;
    consumed += symbolWidth;
  }

  return `...${output}`;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>((output, key) => (
    source[key] !== undefined
      ? {
          ...output,
          [key]: source[key],
        }
      : output
  ), {});
}

function cleanCliText(value: string): string {
  return value.replace(/\^/g, "");
}

function shouldRenderToolDetails(options: ClientOptions): boolean {
  return options.detailMode === AgentCliDetailMode.Tools || options.detailMode === AgentCliDetailMode.All;
}

function shouldRenderErrorDetails(options: ClientOptions): boolean {
  return options.detailMode === AgentCliDetailMode.Errors || options.detailMode === AgentCliDetailMode.All;
}

function previewFormatter(): AgentCliPreviewFormatter {
  if (currentPreviewFormatter) {
    return currentPreviewFormatter;
  }

  const defaults = resolveAgentDefaults(undefined);
  currentPreviewFormatter = new AgentCliPreviewFormatter({
    model: defaults.ModelProviderDefaults.Model,
    tokenLimit: defaults.Cli.Display.PreviewTokenLimit,
  });
  return currentPreviewFormatter;
}

function previewStructuredValue(value: unknown): unknown {
  return previewFormatter().previewStructuredValue(value);
}

function previewStructuredRecord(value: unknown): Record<string, unknown> {
  return normalizeRecord(previewStructuredValue(value));
}

function readPreviewModel(config: AgentSystemConfig | undefined): string {
  const defaults = resolveAgentDefaults(config);
  return config
    ? resolveModelProviderConfig(config).Model
    : defaults.ModelProviderDefaults.Model;
}

function isTerminalEvent(event: AgentEventEnvelope<string, unknown>): boolean {
  return event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "request.invalid";
}

function isEventEnvelope(value: unknown): value is AgentEventEnvelope<string, unknown> {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { channel?: unknown }).channel === AgentEventChannels.AgentEvent
    && typeof (value as { kind?: unknown }).kind === "string",
  );
}
