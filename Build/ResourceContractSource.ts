import { format, resolveConfig } from "prettier";
import { AgentShortIdContract } from "../Source/AgentSystem/Identity/AgentShortId.js";
import {
  AgentResourceHttpRoutes,
  AgentResourceUriContract,
} from "../Source/AgentSystem/Resources/AgentResourceContract.js";

export const FrontendResourceContractPath = "Packages/ResourceLinks/src/resourceContract.ts";

export async function formatFrontendResourceContract(source: string): Promise<string> {
  const filePath = FrontendResourceContractPath;
  const prettierConfig = await resolveConfig(filePath);
  return format(source, {
    ...prettierConfig,
    filepath: filePath,
  });
}

export function renderFrontendResourceContractSource(): string {
  return [
    "// Generated from the backend resource transport contract.",
    "// Run `npm run generate.resource-contract` after editing the backend contract.",
    "",
    renderConstObject("SeneraShortIdContract", AgentShortIdContract),
    "",
    renderConstObject("SeneraResourceUriContract", AgentResourceUriContract),
    "",
    renderConstObject("SeneraResourceHttpRoutes", AgentResourceHttpRoutes),
    "",
  ].join("\n");
}

function renderConstObject(name: string, values: Readonly<Record<string, string | number>>): string {
  return [
    `export const ${name} = {`,
    ...Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
    "} as const;",
  ].join("\n");
}
