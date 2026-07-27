import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatFrontendMessage, frontendMessage } from "../Frontend/src/i18n/frontendMessageCatalog.js";
import { toPosixRelative, walkFiles } from "./Support/FileWalk.js";

const workspaceRoot = process.cwd();

assert.equal(frontendMessage("chat.sendDisconnected"), "发送失败，连接可能已断开");
assert.equal(frontendMessage("session.bulkDeletePartialFailed", { count: 3 }), "有 3 个会话删除请求发送失败");
assert.equal(formatFrontendMessage("{known} {unknown}", { known: "ok" }), "ok {unknown}");

const frontendSourceRoot = path.join(workspaceRoot, "Frontend", "src");
const migratedFrontendFiles = walkFiles(frontendSourceRoot, { extensions: [".ts", ".tsx"] })
  .map((file) => toPosixRelative(workspaceRoot, file))
  .filter((file) => !file.startsWith("Frontend/src/i18n/"));

for (const relativeFile of migratedFrontendFiles) {
  const text = fs.readFileSync(path.join(workspaceRoot, relativeFile), "utf8");
  assert.doesNotMatch(
    text,
    /toast\.(?:error|warning|success|message)\(\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese toast message; use Frontend/src/i18n/messages/zh-CN.json.`,
  );
  assert.doesNotMatch(
    text,
    /new Error\(\s*(?:`[^`]*[\p{Script=Han}]|"[^"]*[\p{Script=Han}])/u,
    `${relativeFile} contains a direct Chinese Error message; use Frontend/src/i18n/messages/zh-CN.json.`,
  );
}

console.log("Frontend error i18n verification passed.");
