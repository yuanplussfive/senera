import path from "node:path";
import { synchronizeSystemToolContracts } from "./SystemToolContractSource.js";

const check = process.argv.includes("--check");
await synchronizeSystemToolContracts({ extensionRoot: path.resolve("System/Extensions"), check });
console.log(`Generated system tool contracts ${check ? "verified" : "updated"}.`);
