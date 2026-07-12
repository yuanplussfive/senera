import fs from "node:fs";
import path from "node:path";
import { FrontendEventCatalogPath, renderFrontendEventCatalogSource } from "./FrontendEventCatalogSource.js";

const targetPath = path.resolve(process.cwd(), FrontendEventCatalogPath);
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, renderFrontendEventCatalogSource(), "utf8");
console.log(`Generated ${FrontendEventCatalogPath}.`);
