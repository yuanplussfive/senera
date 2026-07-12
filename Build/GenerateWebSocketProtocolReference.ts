import fs from "node:fs";
import path from "node:path";
import {
  renderWebSocketProtocolReference,
  renderWebSocketProtocolSchema,
  WebSocketProtocolReferencePath,
  WebSocketProtocolSchemaPath,
} from "./WebSocketProtocolReferenceSource.js";

const outputs = [
  [WebSocketProtocolReferencePath, renderWebSocketProtocolReference()],
  [WebSocketProtocolSchemaPath, renderWebSocketProtocolSchema()],
] as const;

for (const [relativePath, content] of outputs) {
  const targetPath = path.resolve(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`Generated ${relativePath}.`);
}
