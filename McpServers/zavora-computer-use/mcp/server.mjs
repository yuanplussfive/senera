import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createComputerUseServer } from "@zavora-ai/computer-use-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

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
