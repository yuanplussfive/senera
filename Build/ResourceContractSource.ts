import { format, resolveConfig } from "prettier";
import {
  AgentResourceHttpRoutes,
  AgentResourceUriContract,
} from "../Source/AgentSystem/Resources/AgentResourceContract.js";

export const FrontendResourceContractPath = "Frontend/src/api/resourceContract.ts";

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
    renderConstObject("SeneraResourceUriContract", AgentResourceUriContract),
    "",
    renderConstObject("SeneraResourceHttpRoutes", AgentResourceHttpRoutes),
    "",
  ].join("\n");
}

function renderConstObject(name: string, values: Readonly<Record<string, string>>): string {
  return [
    `export const ${name} = {`,
    ...Object.entries(values).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
    "} as const;",
  ].join("\n");
}
