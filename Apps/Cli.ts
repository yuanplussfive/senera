import * as readline from "node:readline";
import { WebSocket } from "ws";
import { AgentCliPreviewFormatter } from "../Source/AgentSystem/CliDisplay/AgentCliPreviewFormatter.js";
import { AgentConsoleTheme } from "../Source/AgentSystem/CliDisplay/AgentConsoleTheme.js";
import { AgentEventKinds } from "../Source/AgentSystem/Events/AgentEvent.js";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { createSessionId, describeSessionHandle } from "../Source/AgentSystem/Core/AgentIds.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import {
  clearCliEventPrinterCaches,
  isSessionReadyEvent,
  parseEvent,
  printEvent,
  printUserRequest,
} from "./CliEventPrinter.js";
import {
  readOptions,
  startCliConfigWatcher,
  type ClientOptions,
} from "./CliOptions.js";

interface PendingRequest {
  requestId: string;
  startedAt: number;
  timeout: NodeJS.Timeout;
  input: string;
}

let logger = new AgentLogger();
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

async function runInteractiveClient(options: ClientOptions): Promise<void> {
  const socket = await openSocket(options.url);
  const configWatcher = startCliConfigWatcher(options, {
    logger: () => logger,
    setLogger: (nextLogger) => {
      logger = nextLogger;
    },
    setPreviewFormatter: (formatter) => {
      currentPreviewFormatter = formatter;
    },
  });
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
    const terminalReached = printEvent(event, state, {
      logger,
      options,
      previewFormatter,
    });
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

    clearCliEventPrinterCaches();
    printUserRequest(input, {
      logger,
      options,
      previewFormatter,
    });

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

function cleanCliText(value: string): string {
  return value.replace(/\^/g, "");
}

function previewFormatter(): AgentCliPreviewFormatter {
  if (currentPreviewFormatter) {
    return currentPreviewFormatter;
  }

  const defaults = resolveAgentDefaults(undefined);
  currentPreviewFormatter = new AgentCliPreviewFormatter({
    model: defaults.ModelRuntime.Model,
    tokenLimit: defaults.Cli.Display.PreviewTokenLimit,
  });
  return currentPreviewFormatter;
}