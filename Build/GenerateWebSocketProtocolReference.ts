import path from "node:path";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";
import {
  renderWebSocketProtocolReference,
  renderWebSocketProtocolSchema,
  WebSocketProtocolReferencePath,
  WebSocketProtocolSchemaPath,
} from "./WebSocketProtocolReferenceSource.js";

const check = process.argv.includes("--check");
const outputs = [
  [WebSocketProtocolReferencePath, renderWebSocketProtocolReference()],
  [WebSocketProtocolSchemaPath, renderWebSocketProtocolSchema()],
] as const;

for (const [relativePath, content] of outputs) {
  synchronizeGeneratedFile({
    filePath: path.resolve(process.cwd(), relativePath),
    content,
    check,
    regenerateCommand: "npm run generate.protocol-reference",
  });
  console.log(`${check ? "Verified" : "Generated"} ${relativePath}.`);
}
