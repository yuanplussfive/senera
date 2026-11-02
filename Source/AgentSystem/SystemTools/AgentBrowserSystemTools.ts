import { AgentBrowserConfigurationSchema } from "../Browser/AgentBrowserConfiguration.js";
import { AgentBrowserRuntime } from "../Browser/AgentBrowserRuntime.js";
import type { AgentBrowserOperation } from "../Browser/AgentBrowserTypes.js";
import {
  defineSystemTool,
  systemToolExecutionResult,
  type AgentSystemToolDefinition,
} from "./AgentSystemToolDefinition.js";

interface BrowserToolBinding {
  readonly capability: string;
  readonly operation: AgentBrowserOperation;
}

/**
 * This is an implementation registry, not a second tool contract. The
 * extension package owns the public name, schemas, permissions, presentation,
 * discovery data, and runtime declaration for each capability below.
 */
const BrowserToolBindings = [
  { capability: "system.tool.agent-browser.BrowserOpen", operation: "open" },
  { capability: "system.tool.agent-browser.BrowserRead", operation: "read" },
  { capability: "system.tool.agent-browser.BrowserSnapshot", operation: "snapshot" },
  { capability: "system.tool.agent-browser.BrowserClick", operation: "click" },
  { capability: "system.tool.agent-browser.BrowserFill", operation: "fill" },
  { capability: "system.tool.agent-browser.BrowserType", operation: "type" },
  { capability: "system.tool.agent-browser.BrowserPress", operation: "press" },
  { capability: "system.tool.agent-browser.BrowserCheck", operation: "check" },
  { capability: "system.tool.agent-browser.BrowserUncheck", operation: "uncheck" },
  { capability: "system.tool.agent-browser.BrowserSelect", operation: "select" },
  { capability: "system.tool.agent-browser.BrowserScroll", operation: "scroll" },
  { capability: "system.tool.agent-browser.BrowserWait", operation: "wait_ms" },
  { capability: "system.tool.agent-browser.BrowserWaitForSelector", operation: "wait_for_selector" },
  { capability: "system.tool.agent-browser.BrowserWaitForText", operation: "wait_for_text" },
  { capability: "system.tool.agent-browser.BrowserWaitForLoad", operation: "wait_for_load" },
  { capability: "system.tool.agent-browser.BrowserWaitForUrl", operation: "wait_for_url" },
  { capability: "system.tool.agent-browser.BrowserWaitForFunction", operation: "wait_for_function" },
  { capability: "system.tool.agent-browser.BrowserScreenshot", operation: "screenshot" },
  { capability: "system.tool.agent-browser.BrowserComputer", operation: "computer" },
  { capability: "system.tool.agent-browser.BrowserDownload", operation: "download" },
  { capability: "system.tool.agent-browser.BrowserGetText", operation: "get_text" },
  { capability: "system.tool.agent-browser.BrowserGetUrl", operation: "get_url" },
  { capability: "system.tool.agent-browser.BrowserGetTitle", operation: "get_title" },
  { capability: "system.tool.agent-browser.BrowserClose", operation: "close" },
  { capability: "system.tool.agent-browser.BrowserBack", operation: "back" },
  { capability: "system.tool.agent-browser.BrowserForward", operation: "forward" },
  { capability: "system.tool.agent-browser.BrowserReload", operation: "reload" },
  { capability: "system.tool.agent-browser.BrowserTabNew", operation: "tab_new" },
  { capability: "system.tool.agent-browser.BrowserTabList", operation: "tab_list" },
  { capability: "system.tool.agent-browser.BrowserTabSwitch", operation: "tab_switch" },
  { capability: "system.tool.agent-browser.BrowserTabClose", operation: "tab_close" },
] as const satisfies readonly BrowserToolBinding[];

export function createAgentBrowserSystemTools(
  extensionConfiguration?: Record<string, unknown>,
  runtime?: AgentBrowserRuntime,
): readonly AgentSystemToolDefinition[] {
  const configuration = AgentBrowserConfigurationSchema.parse(extensionConfiguration ?? {});
  const browser = runtime ?? new AgentBrowserRuntime({ workspaceRoot: process.cwd(), configuration });
  return BrowserToolBindings.map(({ capability, operation }) =>
    defineSystemTool({
      capability,
      execute: async (arguments_, context) => (await browser.execute(operation, arguments_, context)).result,
      executeWithArtifacts: async (arguments_, context) => {
        const execution = await browser.execute(operation, arguments_, context);
        return systemToolExecutionResult(execution.result, { artifactPayload: execution.artifactPayload });
      },
    }),
  );
}
