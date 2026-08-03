import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AgentLocales,
  agentErrorMessage,
  formatAgentMessage,
  projectAgentLocalizedMessage,
  readAgentErrorMessageTemplate,
} from "../Source/AgentSystem/I18n/AgentMessageCatalog.js";
import { AgentLocalizedError } from "../Source/AgentSystem/I18n/AgentLocalizedError.js";
import { projectAgentErrorMessage } from "../Source/AgentSystem/I18n/AgentMessageProjection.js";
import { toPosixRelative, walkFiles } from "./Support/FileWalk.js";

const workspaceRoot = process.cwd();

assert.equal(agentErrorMessage("extension.referenceValidationFailed"), "扩展引用校验失败：");
assert.equal(formatAgentMessage("missing {known} {unknown}", { known: "value" }), "missing value {unknown}");
assert.equal(readAgentErrorMessageTemplate("tool.executionMissingConfig"), "工具缺少 Execution 配置：{toolName}");
assert.equal(
  readAgentErrorMessageTemplate("tool.executionMissingConfig", AgentLocales.EnUs),
  "The tool is missing its Execution configuration: {toolName}",
);

const localized = projectAgentLocalizedMessage("approval.requestNotPending", { approvalId: "approval-1" });
assert.deepEqual(localized, {
  key: "approval.requestNotPending",
  params: { approvalId: "approval-1" },
  text: {
    "zh-CN": "审批请求不存在或已结束：approval-1",
    "en-US": "The approval request does not exist or has already ended: approval-1",
  },
});
assert.equal(
  projectAgentErrorMessage(
    new AgentLocalizedError("config.providerEndpointMissing", { providerId: "provider-1" }),
    "config.operationFailed",
  ).localizedMessage.text["en-US"],
  "The provider endpoint does not exist: ProviderId=provider-1",
);

verifyCatalogParity();

const migratedRuntimeDirectories = [
  "ActionPlanner",
  "Approvals",
  "Config",
  "Mcp",
  "ModelEndpoints",
  "PiProxy",
  "Extensions",
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
    /(?:throw new [A-Za-z0-9_]*Error|message:|suggestion:|createAgentStructuredIssue)\s*\(\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese runtime error message; use I18n/messages.zh-CN.json.`,
  );
  assert.doesNotMatch(
    text,
    /(?:message|suggestion):\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese diagnostic message; use I18n/messages.zh-CN.json.`,
  );
}

const agentRuntimeFiles = walkFiles(path.join(workspaceRoot, "Source", "AgentSystem"), { extensions: [".ts"] })
  .map((file) => toPosixRelative(workspaceRoot, file))
  .filter((file) => !file.includes("/I18n/"));

for (const relativeFile of agentRuntimeFiles) {
  const text = fs.readFileSync(path.join(workspaceRoot, relativeFile), "utf8");
  assert.doesNotMatch(
    text,
    /new\s+[A-Za-z0-9_]*Error\s*\(\s*agentErrorMessage\s*\(/u,
    `${relativeFile} discards i18n metadata; throw AgentLocalizedError with a message key and params.`,
  );
}

console.log("Agent error i18n verification passed.");

function verifyCatalogParity(): void {
  const zhCn = readCatalog("messages.zh-CN.json");
  const enUs = readCatalog("messages.en-US.json");
  assert.deepEqual(
    Object.keys(enUs).sort(),
    Object.keys(zhCn).sort(),
    "Agent locale catalogs must contain identical keys.",
  );

  for (const key of Object.keys(zhCn)) {
    assert.deepEqual(
      readPlaceholders(enUs[key]),
      readPlaceholders(zhCn[key]),
      `Agent locale placeholder mismatch for ${key}.`,
    );
    assert.doesNotMatch(enUs[key], /\p{Script=Han}/u, `English agent message contains Han text: ${key}`);
  }
}

function readCatalog(fileName: string): Record<string, string> {
  const file = path.join(workspaceRoot, "Source", "AgentSystem", "I18n", fileName);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
}

function readPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}
