import { readFile } from "node:fs/promises";
import process from "node:process";

const [inputPath, ...fields] = process.argv.slice(2);

if (!inputPath || fields.length === 0) {
  throw new Error("Usage: select-fields.mjs <json-file> <field> [field...]");
}

const input = JSON.parse(await readFile(inputPath, "utf8"));
const result = Array.isArray(input) ? input.map((value) => project(value, fields)) : project(input, fields);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function project(value, selectedFields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Input must be a JSON object or an array of JSON objects.");
  }

  return Object.fromEntries(
    selectedFields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]),
  );
}
