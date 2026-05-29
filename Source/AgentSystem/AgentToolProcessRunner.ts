import { spawn } from "node:child_process";
import path from "node:path";
import parseJson from "json-parse-even-better-errors";
import type {
  AgentSystemConfig,
  AgentToolProcessRequest,
  AgentToolProcessError,
  AgentToolProcessResponse,
  PluginEntryManifest,
  RegisteredTool,
} from "./Types.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";

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

  async run(tool: RegisteredTool, args: Record<string, unknown>): Promise<AgentToolProcessRunResult> {
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
      protocol: AgentToolProcessProtocol,
      tool: tool.name,
      arguments: args,
    };

    return this.spawnProcessEntry(tool, entry, request);
  }

  private spawnProcessEntry(
    tool: RegisteredTool,
    entry: PluginEntryManifest,
    request: AgentToolProcessRequest,
  ): Promise<AgentToolProcessRunResult> {
    const timeoutMs = this.config.ToolExecution?.TimeoutMs ?? 10000;
    const maxStdoutBytes = this.config.ToolExecution?.MaxStdoutBytes ?? 200000;
    const maxStderrBytes = this.config.ToolExecution?.MaxStderrBytes ?? 200000;
    const cwd = this.resolveEntryCwd(tool, entry);
    const command = entry.Command;
    const commandArgs = entry.Args ?? [];
    const processLabel = [command, ...commandArgs].join(" ");

    return new Promise((resolve) => {
      const child = this.spawnProcess(command, commandArgs, {
        cwd,
        env: {
          ...process.env,
          SENERA_WORKSPACE_ROOT: path.resolve(this.workspaceRoot),
          SENERA_PLUGIN_ROOT: tool.plugin.rootPath,
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
      const settle = (result: AgentToolProcessRunResult): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
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
            message: "工具进程没有输出最后一行 JSON 协议响应。",
            pointer: "/",
            path: [],
            suggestion: "确保插件最后一行 stdout 输出 AgentToolProcess 协议 JSON。",
          },
        ],
      });
    }

    const lastLine = lines[lines.length - 1];
    let response: AgentToolProcessResponse;
    try {
      response = parseJson(lastLine) as AgentToolProcessResponse;
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

    if (response.protocol !== AgentToolProcessProtocol) {
      return this.failureResponse({
        code: AgentExecutionErrorCodes.ToolProcessProtocolInvalid,
        message: `工具进程响应协议无效：${context.modulePath}`,
        details: {
          phase: AgentToolProcessErrorPhases.ProtocolValidation,
          modulePath: context.modulePath,
          protocol: response.protocol,
          expectedProtocol: AgentToolProcessProtocol,
          exitCode: context.exitCode,
          signal: context.signal,
        },
        diagnostics: [
          {
            message: `工具进程响应 protocol 不匹配，期望 ${AgentToolProcessProtocol}。`,
            pointer: "/protocol",
            path: ["protocol"],
            suggestion: "确保插件响应中的 protocol 字段与宿主定义完全一致。",
          },
        ],
      });
    }

    return response;
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
    return {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error,
    };
  }
}
