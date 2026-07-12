import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  renderWebSocketProtocolReference,
  renderWebSocketProtocolSchema,
  WebSocketProtocolReferencePath,
  WebSocketProtocolSchemaPath,
} from "../Build/WebSocketProtocolReferenceSource.js";

const workspaceRoot = process.cwd();

verifyGeneratedReference(WebSocketProtocolReferencePath, renderWebSocketProtocolReference());
verifyGeneratedReference(WebSocketProtocolSchemaPath, renderWebSocketProtocolSchema());
console.log("WebSocket protocol reference verified.");

function verifyGeneratedReference(relativePath: string, expected: string): void {
  const targetPath = path.join(workspaceRoot, ...relativePath.split("/"));
  assert.ok(fs.existsSync(targetPath), `${relativePath} is missing. Run npm run generate.protocol-reference.`);
  assert.equal(
    normalizeLineEndings(fs.readFileSync(targetPath, "utf8")),
    normalizeLineEndings(expected),
    `${relativePath} is stale. Run npm run generate.protocol-reference.`,
  );
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}
