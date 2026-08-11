import path from "node:path";
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
  `${check ? "Verified" : "Generated"} ${FrontendEventCatalogPath}, ${FrontendEventSpecsPath}, and ${FrontendRuntimeDiagnosticCatalogPath}.`,
);
