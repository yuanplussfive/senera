import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  agentErrorMessage,
  formatAgentMessage,
  readAgentErrorMessageTemplate,
} from "../Source/AgentSystem/I18n/AgentMessageCatalog.js";

const workspaceRoot = process.cwd();

assert.equal(
  agentErrorMessage("plugin.duplicateName", { pluginName: "VerifyPlugin" }),
  "插件名重复：VerifyPlugin",
);
assert.equal(
  formatAgentMessage("missing {known} {unknown}", { known: "value" }),
  "missing value {unknown}",
);
assert.equal(
  readAgentErrorMessageTemplate("tool.executionMissingConfig"),
  "工具缺少 Execution 配置：{toolName}",
);

const migratedRuntimeFiles = [
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "ActionPlanner")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "Approvals")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "Config")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "Mcp")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "ModelEndpoints")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "PiProxy")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "Plugin")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "ToolRuntime")),
  ...walkSourceFiles(path.join(workspaceRoot, "Source", "AgentSystem", "WebSocket")),
  path.join(workspaceRoot, "Source", "AgentSystem", "AgentRootCommand.ts"),
].map((file) => path.relative(workspaceRoot, file).replaceAll(path.sep, "/"))
  .filter((file) => !file.includes("/I18n/"))
  .filter((file) => !file.includes("/PiProxy/AgentPiProxyPrompts.ts"));

for (const relativeFile of migratedRuntimeFiles) {
  const text = fs.readFileSync(path.join(workspaceRoot, relativeFile), "utf8");
  assert.doesNotMatch(
    text,
    /(?:throw new Error|message:|suggestion:|createAgentStructuredIssue)\s*\(\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese runtime error message; use AgentErrorMessages.zh-CN.ts.`,
  );
  assert.doesNotMatch(
    text,
    /(?:message|suggestion):\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese diagnostic message; use AgentErrorMessages.zh-CN.ts.`,
  );
}

console.log("Agent error i18n verification passed.");

function walkSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkSourceFiles(fullPath);
    }
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}
