import crypto from "node:crypto";
import fs from "node:fs";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraProcessFallbackSubject } from "../Execution/SeneraProcessFallbackAuthorization.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";

export interface AgentToolExecutionCorrelation {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
  readonly toolCallId?: string;
  readonly batchId?: string;
  readonly onEvent?: AgentEventSink;
}

export function bindAgentToolFallbackContext(input: {
  readonly profile: SeneraProcessExecutionProfile;
  readonly tool: RegisteredTool;
  readonly correlation: AgentToolExecutionCorrelation;
}): SeneraProcessExecutionProfile {
  if (
    input.profile.backend !== "sandbox" ||
    input.profile.localFallback !== "allow" ||
    !input.correlation.sessionId ||
    !input.correlation.requestId ||
    input.correlation.step === undefined
  ) {
    return input.profile;
  }

  return {
    ...input.profile,
    fallbackContext: {
      sessionId: input.correlation.sessionId,
      requestId: input.correlation.requestId,
      step: input.correlation.step,
      toolCallId: input.correlation.toolCallId,
      batchId: input.correlation.batchId,
      onEvent: input.correlation.onEvent,
      subject: projectAgentToolFallbackSubject(input.tool),
    },
  };
}

export function projectAgentToolFallbackSubject(tool: RegisteredTool): SeneraProcessFallbackSubject {
  const plugin = tool.plugin;
  if (tool.execution.Boundary === "Local") {
    throw new Error(`Local tool ${tool.name} cannot create a sandbox fallback subject.`);
  }

  return {
    pluginName: plugin.manifest.Plugin.Name,
    pluginTitle: plugin.manifest.Plugin.Title ?? plugin.manifest.Plugin.Name,
    pluginVersion: plugin.manifest.Plugin.Version,
    manifestDigest: sha256(fs.readFileSync(plugin.manifestPath)),
    rootKind: plugin.rootKind,
    trustLevel: plugin.manifest.Security?.TrustLevel,
    toolName: tool.name,
    boundary: tool.execution.Boundary,
    network: tool.execution.Network,
    workspace: tool.execution.Workspace,
    permissions: [...tool.permissions],
  };
}

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
