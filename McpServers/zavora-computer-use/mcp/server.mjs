import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// The bundled dependency also contains a standalone stdio launcher. Remove
// the entry-point argument while importing its factory so this wrapper is the
// only process that owns the MCP transport.
const invokedEntryPoint = process.argv.splice(1, 1)[0];
let createComputerUseServer;
try {
  ({ createComputerUseServer } = await import("@zavora-ai/computer-use-mcp"));
} finally {
  if (invokedEntryPoint !== undefined) process.argv.splice(1, 0, invokedEntryPoint);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeAsset = path.join(packageRoot, `computer-use-napi.${process.platform}-${process.arch}.node`);
if (existsSync(nativeAsset)) process.env.COMPUTER_USE_NATIVE_PATH ??= nativeAsset;

const server = createComputerUseServer({
  profile: "full",
  activeProfile: "full",
  structuredContent: true,
  vision: true,
});

await server.connect(new StdioServerTransport());
