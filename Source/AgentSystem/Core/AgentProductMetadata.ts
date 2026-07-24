import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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
  return AgentProductMetadataSchema.parse(JSON.parse(fs.readFileSync(packagePath, "utf8")));
}
