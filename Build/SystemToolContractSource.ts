import fs from "node:fs";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { AgentMemoryRecallToolResultJsonSchema } from "../Source/AgentSystem/Continuity/AgentMemoryRecallToolContract.js";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";
import { z } from "zod";
import {
  AgentImageGenerateArgumentsSchema,
  AgentImageGenerateResultSchema,
  AgentImageModelsResultSchema,
} from "../Source/AgentSystem/Images/AgentImageGenerationContract.js";
import { AgentImageToolsExtensionConfigurationSchema } from "../Source/AgentSystem/Images/AgentImageToolsConfiguration.js";
import {
  AgentCodemodeConfigurationSchema,
  AgentCodemodeResultSchema,
} from "../Source/AgentSystem/SystemTools/AgentCodemodeContract.js";

const ToolContracts = [
  {
    path: "explore/agent-image-tools/tools/ImageGenerate.tool.json",
    inputSchema: z.toJSONSchema(AgentImageGenerateArgumentsSchema, { target: "draft-7" }),
    outputSchema: z.toJSONSchema(AgentImageGenerateResultSchema, { target: "draft-7" }),
  },
  {
    path: "explore/agent-image-tools/tools/ImageModels.tool.json",
    outputSchema: z.toJSONSchema(AgentImageModelsResultSchema, { target: "draft-7" }),
  },
  {
    path: "execute/codemode/tools/Codemode.tool.json",
    outputSchema: z.toJSONSchema(AgentCodemodeResultSchema, { target: "draft-7" }),
  },
  {
    path: "knowledge/memory-recall/tools/MemoryRecallTool.tool.json",
    outputSchema: AgentMemoryRecallToolResultJsonSchema,
  },
] as const;

const ConfigurationContracts = [
  {
    path: "explore/agent-image-tools/config.schema.json",
    schema: z.toJSONSchema(AgentImageToolsExtensionConfigurationSchema, { target: "draft-7", io: "input" }),
  },
  {
    path: "execute/codemode/config.schema.json",
    schema: z.toJSONSchema(AgentCodemodeConfigurationSchema, { target: "draft-7", io: "input" }),
  },
] as const;

/** Generate schema fields only; package metadata and presentation remain package-owned. */
export async function synchronizeSystemToolContracts(options: {
  extensionRoot: string;
  check: boolean;
}): Promise<void> {
  for (const source of ToolContracts) {
    const filePath = path.join(options.extensionRoot, source.path);
    const contract: Record<string, unknown> = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const outputSchema = source.outputSchema;
    const content = await format(
      JSON.stringify({
        ...contract,
        ...("inputSchema" in source ? { inputSchema: source.inputSchema } : {}),
        outputSchema,
      }),
      {
        ...(await resolveConfig(filePath)),
        filepath: filePath,
      },
    );
    synchronizeGeneratedFile({
      filePath,
      content,
      check: options.check,
      regenerateCommand: "npm run generate.system-tool-contracts",
    });
  }
  for (const source of ConfigurationContracts) {
    const filePath = path.join(options.extensionRoot, source.path);
    const content = await format(JSON.stringify(source.schema), {
      ...(await resolveConfig(filePath)),
      filepath: filePath,
    });
    synchronizeGeneratedFile({
      filePath,
      content,
      check: options.check,
      regenerateCommand: "npm run generate.system-tool-contracts",
    });
  }
}
