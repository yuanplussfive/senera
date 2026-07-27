import path from "node:path";
import { FrontendEventCatalogPath, renderFrontendEventCatalogSource } from "./FrontendEventCatalogSource.js";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";

const check = process.argv.includes("--check");
synchronizeGeneratedFile({
  filePath: path.resolve(process.cwd(), FrontendEventCatalogPath),
  content: renderFrontendEventCatalogSource(),
  check,
  regenerateCommand: "npm run generate.frontend-events",
});
console.log(`${check ? "Verified" : "Generated"} ${FrontendEventCatalogPath}.`);
