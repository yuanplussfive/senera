import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { RootCommandSchema } from "../Schemas/AgentRootCommandContractSchema.js";

const AgentRootCommandCatalogSchema = z
  .object({
    rootCommands: z.array(RootCommandSchema),
  })
  .strict();

export class AgentPromptAssetCatalog {
  private readonly json = new AgentJsonFileLoader();

  registerRoot(registry: AgentExtensionRegistry, rootPath: string): void {
    const root = path.resolve(rootPath);
    const templatesRoot = path.join(root, "Templates");
    const templates = fs
      .readdirSync(templatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && path.extname(entry.name) === ".liquid")
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        name: path.basename(entry.name, ".liquid"),
        path: path.join(templatesRoot, entry.name),
        exposeToPi: false,
      }));
    const rootCommands = this.json.load(
      path.join(root, "RootCommands.json"),
      AgentRootCommandCatalogSchema,
    ).rootCommands;
    registry.registerPromptAssets(templates, rootCommands);
  }
}
