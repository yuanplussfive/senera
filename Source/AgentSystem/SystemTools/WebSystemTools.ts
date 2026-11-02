import type { AgentBrowserRuntime } from "../Browser/AgentBrowserRuntime.js";
import { AgentWebToolsConfigurationSchema } from "../Web/AgentWebConfiguration.js";
import { projectAgentWebFetchModelOutput } from "../Web/AgentWebFetchModelOutput.js";
import { DefaultAgentWebRuntime } from "../Web/AgentWebRuntime.js";
import type { AgentWebFetchRequest, AgentWebSearchRequest } from "../Web/AgentWebTypes.js";
import {
  defineSystemTool,
  systemToolArguments,
  systemToolExecutionResult,
  type AgentSystemToolDefinition,
} from "./AgentSystemToolDefinition.js";

const WebSearchCapability = "system.tool.web-tools.WebSearch";
const WebFetchCapability = "system.tool.web-tools.WebFetch";

/**
 * Tool packages publish the WebSearch and WebFetch contracts. This module only
 * binds those declared capabilities to the web runtime.
 */
export function createWebSystemTools(
  extensionConfiguration?: Record<string, unknown>,
  options: {
    readonly browserRuntime?: AgentBrowserRuntime;
    readonly model?: string;
    readonly resolveModel?: (configuredModelId: string) => string;
  } = {},
): readonly AgentSystemToolDefinition[] {
  const configuration = AgentWebToolsConfigurationSchema.parse(extensionConfiguration ?? {});
  const runtime = new DefaultAgentWebRuntime(configuration, {
    browserRuntime: options.browserRuntime,
    model: options.model,
    resolveModel: options.resolveModel,
  });
  return [
    defineSystemTool({
      capability: WebSearchCapability,
      async execute(arguments_, context) {
        const input = systemToolArguments<AgentWebSearchRequest & Record<string, unknown>>(arguments_);
        const output = await runtime.search(input, context.signal);
        return { query: output.query, results: output.results.map((result) => ({ ...result })) };
      },
    }),
    defineSystemTool({
      capability: WebFetchCapability,
      async execute(arguments_, context) {
        const input = systemToolArguments<AgentWebFetchRequest & Record<string, unknown>>(arguments_);
        return projectAgentWebFetchModelOutput(await runtime.fetch(input, context.signal, context));
      },
      async executeWithArtifacts(arguments_, context) {
        const input = systemToolArguments<AgentWebFetchRequest & Record<string, unknown>>(arguments_);
        const output = await runtime.fetch(input, context.signal, context);
        return systemToolExecutionResult(projectAgentWebFetchModelOutput(output), {
          artifactPayload: { rawResponse: output },
        });
      },
    }),
  ];
}

export const WebSystemTools = createWebSystemTools();
