import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  formatFrontendGeneratedSource,
  FrontendEventCatalogPath,
  FrontendEventSpecsPath,
  FrontendRuntimeDiagnosticCatalogPath,
  renderFrontendEventCatalogSource,
  renderFrontendEventSpecsSource,
  renderFrontendRuntimeDiagnosticCatalogSource,
} from "./FrontendEventCatalogSource.js";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";

const check = process.argv.includes("--check");
const sharedContracts = [
  { source: "AgentInteractionInputContract.ts", target: "generatedInteractionInputContract.ts" },
  { source: "AgentFeedbackContract.ts", target: "generatedFeedbackContract.ts" },
  { source: "AgentModelCapabilityContract.ts", target: "generatedModelCapabilityContract.ts" },
] as const;
for (const { source, target } of sharedContracts) {
  const contractPath = `Frontend/src/api/${target}`;
  const contract = await readFile(path.resolve(process.cwd(), "Source/AgentSystem/Core", source), "utf8");
  synchronizeGeneratedFile({
    filePath: path.resolve(process.cwd(), contractPath),
    content: await formatFrontendGeneratedSource(
      `// Generated from ${source}. Do not edit.\n${contract}`,
      contractPath,
    ),
    check,
    regenerateCommand: "npm run generate.frontend-events",
  });
}
const eventCatalogFilePath = path.resolve(process.cwd(), FrontendEventCatalogPath);
const eventSpecsFilePath = path.resolve(process.cwd(), FrontendEventSpecsPath);
const runtimeDiagnosticCatalogFilePath = path.resolve(process.cwd(), FrontendRuntimeDiagnosticCatalogPath);
const eventCatalogContent = await formatFrontendGeneratedSource(
  renderFrontendEventCatalogSource(),
  eventCatalogFilePath,
);
synchronizeGeneratedFile({
  filePath: eventCatalogFilePath,
  content: eventCatalogContent,
  check,
  regenerateCommand: "npm run generate.frontend-events",
});
const eventSpecsContent = await formatFrontendGeneratedSource(renderFrontendEventSpecsSource(), eventSpecsFilePath);
synchronizeGeneratedFile({
  filePath: eventSpecsFilePath,
  content: eventSpecsContent,
  check,
  regenerateCommand: "npm run generate.frontend-events",
});
const runtimeDiagnosticCatalogContent = await formatFrontendGeneratedSource(
  renderFrontendRuntimeDiagnosticCatalogSource(),
  runtimeDiagnosticCatalogFilePath,
);
synchronizeGeneratedFile({
  filePath: runtimeDiagnosticCatalogFilePath,
  content: runtimeDiagnosticCatalogContent,
  check,
  regenerateCommand: "npm run generate.frontend-events",
});
console.log(
  `${check ? "Verified" : "Generated"} ${FrontendEventCatalogPath}, ${FrontendEventSpecsPath}, ${FrontendRuntimeDiagnosticCatalogPath}, and shared contracts.`,
);
