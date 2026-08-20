import path from "node:path";
import {
  formatFrontendResourceContract,
  FrontendResourceContractPath,
  renderFrontendResourceContractSource,
} from "./ResourceContractSource.js";
import { synchronizeGeneratedFile } from "./GeneratedTextFile.js";

const check = process.argv.includes("--check");
const filePath = path.resolve(process.cwd(), FrontendResourceContractPath);
const content = await formatFrontendResourceContract(renderFrontendResourceContractSource());

synchronizeGeneratedFile({
  filePath,
  content,
  check,
  regenerateCommand: "npm run generate.resource-contract",
});

console.log(`${check ? "Verified" : "Generated"} ${FrontendResourceContractPath}.`);
