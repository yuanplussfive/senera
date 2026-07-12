import path from "node:path";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { PluginEntryManifest } from "../Types/PluginManifestTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import { failedToolProcessResult } from "./AgentToolProcessResultFactory.js";

export type AgentToolProcessEntryResolution =
  | {
      ok: true;
      entry: PluginEntryManifest;
      cwd: string;
      command: string;
      args: string[];
      label: string;
    }
  | {
      ok: false;
      result: AgentToolProcessRunResult;
    };

export class AgentToolProcessEntryResolver {
  constructor(private readonly workspaceRoot: string) {}

  resolve(tool: RegisteredTool): AgentToolProcessEntryResolution {
    const entry = tool.plugin.manifest.Plugin.Entry;
    if (!entry) {
      return {
        ok: false,
        result: failedToolProcessResult({
          code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
          message: agentErrorMessage("tool.entryModuleMissing", {
            pluginName: tool.plugin.manifest.Plugin.Name,
          }),
          details: {
            phase: AgentToolProcessErrorPhases.ConfigurationValidation,
            pluginName: tool.plugin.manifest.Plugin.Name,
            toolName: tool.name,
          },
        }),
      };
    }

    if (entry.Kind !== "Process") {
      return {
        ok: false,
        result: failedToolProcessResult({
          code: AgentExecutionErrorCodes.ToolProcessRuntimeUnsupported,
          message: agentErrorMessage("tool.entryTypeUnsupported", { entryKind: entry.Kind }),
          details: {
            phase: AgentToolProcessErrorPhases.ConfigurationValidation,
            pluginName: tool.plugin.manifest.Plugin.Name,
            toolName: tool.name,
            runtime: entry.Kind,
          },
        }),
      };
    }

    const command = entry.Command;
    const args = entry.Args ?? [];
    return {
      ok: true,
      entry,
      cwd: this.resolveEntryCwd(tool, entry),
      command,
      args,
      label: [command, ...args].join(" "),
    };
  }

  workspaceContextRoot(): string {
    return path.resolve(this.workspaceRoot);
  }

  private resolveEntryCwd(tool: RegisteredTool, entry: PluginEntryManifest): string {
    const cwd = entry.Cwd ?? ".";
    return path.isAbsolute(cwd) ? path.normalize(cwd) : path.resolve(tool.plugin.rootPath, cwd);
  }
}
