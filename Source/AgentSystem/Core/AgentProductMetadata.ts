import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseJsonText } from "./AgentJsonParsing.js";

const AgentProductMetadataSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  })
  .passthrough();

export interface AgentProductMetadata {
  version: string;
}

export function readAgentProductMetadata(resourceRoot: string): AgentProductMetadata {
  const packagePath = path.join(resourceRoot, "package.json");
  return AgentProductMetadataSchema.parse(parseJsonText(fs.readFileSync(packagePath, "utf8"), "package.json"));
}
