import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  agentErrorMessage,
  formatAgentMessage,
  readAgentErrorMessageTemplate,
} from "../Source/AgentSystem/I18n/AgentMessageCatalog.js";
import { toPosixRelative, walkFiles } from "./Support/FileWalk.js";

const workspaceRoot = process.cwd();

assert.equal(agentErrorMessage("plugin.duplicateName", { pluginName: "VerifyPlugin" }), "插件名重复：VerifyPlugin");
assert.equal(formatAgentMessage("missing {known} {unknown}", { known: "value" }), "missing value {unknown}");
assert.equal(readAgentErrorMessageTemplate("tool.executionMissingConfig"), "工具缺少 Execution 配置：{toolName}");

const migratedRuntimeDirectories = [
  "ActionPlanner",
  "Approvals",
  "Config",
  "Mcp",
  "ModelEndpoints",
  "PiProxy",
  "Plugin",
  "ToolRuntime",
  "Uploads",
  "WebSocket",
];

const migratedRuntimeFiles = [
  ...migratedRuntimeDirectories.flatMap((directory) =>
    walkFiles(path.join(workspaceRoot, "Source", "AgentSystem", directory), { extensions: [".ts"] }),
  ),
  path.join(workspaceRoot, "Source", "AgentSystem", "AgentRootCommand.ts"),
]
  .map((file) => toPosixRelative(workspaceRoot, file))
  .filter((file) => !file.includes("/I18n/"))
  .filter((file) => !file.includes("/PiProxy/AgentPiProxyPrompts.ts"));

for (const relativeFile of migratedRuntimeFiles) {
  const text = fs.readFileSync(path.join(workspaceRoot, relativeFile), "utf8");
  assert.doesNotMatch(
    text,
    /(?:throw new Error|message:|suggestion:|createAgentStructuredIssue)\s*\(\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese runtime error message; use I18n/messages.zh-CN.json.`,
  );
  assert.doesNotMatch(
    text,
    /(?:message|suggestion):\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese diagnostic message; use I18n/messages.zh-CN.json.`,
  );
}

console.log("Agent error i18n verification passed.");
