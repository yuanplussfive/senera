import fs from "node:fs";
import path from "node:path";
import { createToolContractBundle, z } from "@senera/tool-plugin-sdk";

export function writeToolContractFixture(
  pluginRoot: string,
  pluginIdentity: string,
  toolNames: readonly string[],
): void {
  const bundle = createToolContractBundle(
    toolNames.map((toolName) => ({
      toolName,
      argumentSchema: z.object({}).strict(),
      resultSchema: z.object({}).strict(),
      execute: () => ({}),
    })),
    { sourceIdentity: pluginIdentity },
  );
  fs.writeFileSync(path.join(pluginRoot, "ToolContracts.json"), `${JSON.stringify(bundle)}\n`, "utf8");
}
