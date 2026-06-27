import { spawn } from "node:child_process";
import path from "node:path";
import parseJson from "json-parse-even-better-errors";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import type {
  AgentToolProcessRequest,
  AgentToolProcessError,
  AgentToolProcessResponse,
} from "./Types/ToolRuntimeTypes.js";
import type { PluginEntryManifest } from "./Types/PluginManifestTypes.js";
import type { RegisteredTool } from "./Types/PluginRuntimeTypes.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import { resolveToolExecutionConfig } from "./AgentDefaults.js";
import {
  AgentToolProcessResponseEnvelope,
  createToolProcessFailureResponse,
  validateToolProcessResponseEnvelope,
} from "./AgentToolProcessEnvelope.js";

export interface AgentToolProcessSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  windowsHide: boolean;
}

export interface AgentToolProcessChild {
  stdin: {
    end(chunk?: string): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  stderr: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export type AgentToolProcessSpawner = (
  command: string,
  args: string[],
  options: AgentToolProcessSpawnOptions,
) => AgentToolProcessChild;

export interface AgentToolProcessRunResult {
  response: AgentToolProcessResponse;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export class AgentToolProcessRunner {
  private readonly xmlCodec: AgentXmlCodec;

  constructor(
    private readonly config: AgentSystemConfig,
    private readonly protocol: AgentXmlProtocolSpec,
    private readonly workspaceRoot: string = process.cwd(),
    private readonly spawnProcess: AgentToolProcessSpawner = spawn as AgentToolProcessSpawner,
  ) {
    this.xmlCodec = new AgentXmlCodec(protocol);
  }

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: { signal?: AbortSignal } = {},
  ): Promise<AgentToolProcessRunResult> {
    const entry = tool.plugin.manifest.Plugin.Entry;
    if (!entry) {
      return this.failedResult({
        code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
        message: `工具插件缺少入口模块：${tool.plugin.manifest.Plugin.Name}`,
        details: {
          phase: AgentToolProcessErrorPhases.ConfigurationValidation,
          pluginName: tool.plugin.manifest.Plugin.Name,
          toolName: tool.name,
        },
      });
    }

    if (entry.Kind !== "Process") {
      return this.failedResult({
        code: AgentExecutionErrorCodes.ToolProcessRuntimeUnsupported,
        message: `不支持的插件入口类型：${entry.Kind}`,
        details: {
          phase: AgentToolProcessErrorPhases.ConfigurationValidation,
          pluginName: tool.plugin.manifest.Plugin.Name,
          toolName: tool.name,
          runtime: entry.Kind,
        },
      });
    }

    const request: AgentToolProcessRequest = {
      tool: tool.name,
      arguments: args,
      context: {
        workspaceRoot: path.resolve(this.workspaceRoot),
        pluginRoot: tool.plugin.rootPath,
      },
    };

    return this.spawnProcessEntry(tool, entry, request, context);
  }

  private spawnProcessEntry(
    tool: RegisteredTool,
    entry: PluginEntryManifest,
    request: AgentToolProcessRequest,
    context: { signal?: AbortSignal },
  ): Promise<AgentToolProcessRunResult> {
    const toolExecution = resolveToolExecutionConfig(this.config);
    const timeoutMs = toolExecution.TimeoutMs;
    const maxStdoutBytes = toolExecution.MaxStdoutBytes;
    const maxStderrBytes = toolExecution.MaxStderrBytes;
    const cwd = this.resolveEntryCwd(tool, entry);
    const command = entry.Command;
    const commandArgs = entry.Args ?? [];
    const processLabel = [command, ...commandArgs].join(" ");
    const signal = context.signal;

    if (signal?.aborted) {
      return Promise.resolve(cancelledToolProcessResult({
        signal,
        toolName: tool.name,
        phase: "before_spawn",
        command: processLabel,
        cwd,
      }));
    }

    return new Promise((resolve) => {
      const child = this.spawnProcess(command, commandArgs, {
        cwd,
        env: {
          ...process.env,
          ...(entry.Env ?? {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abortListener = (): void => {
        child.kill("SIGTERM");
        settle(cancelledToolProcessResult({
          signal,
          toolName: tool.name,
          phase: "runtime",
          command: processLabel,
          cwd,
        }));
      };
      const settle = (result: AgentToolProcessRunResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", abortListener);
        resolve(result);
      };

      signal?.addEventListener("abort", abortListener, { once: true });
      if (signal?.aborted) {
        abortListener();
        return;
      }

      timer = setTimeout(() => {
        child.kill("SIGTERM");
        settle(this.failedResult({
          code: AgentExecutionErrorCodes.ToolProcessTimeout,
          message: `工具进程超时，超过 ${timeoutMs}ms：${processLabel}`,
          details: {
            phase: AgentToolProcessErrorPhases.RuntimeExecution,
            modulePath: processLabel,
            cwd,
            timeoutMs,
          },
        }));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        stdoutChunks.push(chunk);
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxStdoutBytes) {
          child.kill("SIGTERM");
          settle(this.failedResult({
            code: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
            message: `工具 stdout 超过 ${maxStdoutBytes} 字节：${processLabel}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              modulePath: processLabel,
              cwd,
              maxStdoutBytes,
              actualBytes: stdoutBytes,
            },
          }));
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }

        stderrChunks.push(chunk);
        stderrBytes += chunk.byteLength;
        if (stderrBytes > maxStderrBytes) {
          child.kill("SIGTERM");
          settle(this.failedResult({
            code: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
            message: `工具 stderr 超过 ${maxStderrBytes} 字节：${processLabel}`,
            details: {
              phase: AgentToolProcessErrorPhases.RuntimeExecution,
              modulePath: processLabel,
              cwd,
              maxStderrBytes,
              actualBytes: stderrBytes,
            },
          }));
        }
      });

      child.on("error", (error) => {
        settle(this.failedResult({
          code: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
          message: error instanceof Error ? error.message : String(error),
          details: {
            phase: AgentToolProcessErrorPhases.ProcessSpawn,
            modulePath: processLabel,
            cwd,
            command,
            args: commandArgs,
          },
          diagnostics: [
            {
              message: error instanceof Error ? error.message : String(error),
              pointer: "/",
              path: [],
              suggestion: "检查插件 Entry.Command、Entry.Args、Entry.Cwd 是否正确，以及工具包依赖是否已安装。",
            },
          ],
        }));
      });

      child.on("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const response = this.parseResponse({
          stdout,
          stderr,
          exitCode,
          signal,
          modulePath: processLabel,
        });

        settle({
          response,
          stdout,
          stderr,
          exitCode,
          signal,
        });
      });

      child.stdin.end(this.xmlCodec.objectToXml(this.protocol.roots.toolCalls, {
        [this.protocol.items.toolCall]: [
          {
            name: request.tool,
            arguments: request.arguments,
            context: request.context,
          },
        ],
      }));
    });
  }

  private resolveEntryCwd(tool: RegisteredTool, entry: PluginEntryManifest): string {
    const cwd = entry.Cwd ?? ".";
    return path.isAbsolute(cwd)
      ? path.normalize(cwd)
      : path.resolve(tool.plugin.rootPath, cwd);
  }

  private parseResponse(context: {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    modulePath: string;
  }): AgentToolProcessResponse {
    const lines = context.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return this.failureResponse({
        code: AgentExecutionErrorCodes.ToolProcessResponseMissing,
        message: `工具进程没有输出结构化 stdout：${context.modulePath}`,
        details: {
          phase: AgentToolProcessErrorPhases.ResponseParsing,
          modulePath: context.modulePath,
          exitCode: context.exitCode,
          signal: context.signal,
        },
        diagnostics: [
          {
            message: "工具进程没有输出最后一行 JSON 响应。",
            pointer: "/",
            path: [],
            suggestion: "确保插件最后一行 stdout 输出工具响应 JSON 对象。",
          },
        ],
      });
    }

    const lastLine = lines[lines.length - 1];
    let response: unknown;
    try {
      response = parseJson(lastLine);
    } catch (error) {
      return this.failureResponse({
        code: AgentExecutionErrorCodes.ToolProcessResponseInvalid,
        message: `工具进程响应不是合法 JSON：${context.modulePath}`,
        details: {
          phase: AgentToolProcessErrorPhases.ResponseParsing,
          modulePath: context.modulePath,
          receivedLine: lastLine,
          parseError: error instanceof Error ? error.message : String(error),
          exitCode: context.exitCode,
          signal: context.signal,
        },
        diagnostics: [
          {
            message: "工具进程最后一行 stdout 不是合法 JSON。",
            pointer: "/",
            path: [],
            suggestion: "确保插件最后一行只输出一个完整 JSON 对象，不要混入额外文本。",
          },
        ],
      });
    }

    const envelope = validateToolProcessResponseEnvelope(response);
    if (!envelope.ok) {
      return this.failureResponse({
        code: AgentExecutionErrorCodes.ToolProcessResponseEnvelopeInvalid,
        message: `工具进程响应 envelope 无效：${context.modulePath}`,
        details: {
          phase: AgentToolProcessErrorPhases.ResponseValidation,
          modulePath: context.modulePath,
          type: readEnvelopeField(response, "type"),
          version: readEnvelopeField(response, "version"),
          expectedType: AgentToolProcessResponseEnvelope.Type,
          expectedVersion: AgentToolProcessResponseEnvelope.Version,
          issues: envelope.issues,
          exitCode: context.exitCode,
          signal: context.signal,
        },
        diagnostics: envelope.issues.map((issue) => ({
          message: issue.message,
          pointer: issue.pointer,
          path: issue.pointer === "/"
            ? []
            : issue.pointer.slice(1).split("/").map((part) =>
                part.replace(/~1/g, "/").replace(/~0/g, "~")),
          suggestion: "确保插件 stdout 最后一行使用宿主定义的工具响应 envelope。",
        })),
      });
    }

    return envelope.response;
  }

  private failedResult(error: AgentToolProcessError): AgentToolProcessRunResult {
    return {
      response: this.failureResponse(error),
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
    };
  }

  private failureResponse(error: AgentToolProcessError): AgentToolProcessResponse {
    return createToolProcessFailureResponse(error);
  }
}

function readEnvelopeField(value: unknown, field: "type" | "version"): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
