import fs from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const replacementRoot = path.join(workspaceRoot, "node_modules", "brace-expansion");
const targetRoot = path.join(
  workspaceRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "node_modules",
  "brace-expansion",
);
const vulnerableVersion = "5.0.7";
const fixedVersion = "5.0.8";

const target = await readPackage(targetRoot);
if (target.version === fixedVersion) process.exit(0);
if (target.version !== vulnerableVersion) {
  throw new Error(
    `Unsupported Pi brace-expansion version ${target.version}; expected ${vulnerableVersion} or ${fixedVersion}.`,
  );
}

const replacement = await readPackage(replacementRoot);
if (replacement.version !== fixedVersion) {
  throw new Error(`Pinned brace-expansion replacement must be ${fixedVersion}; found ${replacement.version}.`);
}

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.cp(replacementRoot, targetRoot, { recursive: true, force: true });

const patched = await readPackage(targetRoot);
if (patched.version !== fixedVersion) {
  throw new Error(`Failed to apply Pi brace-expansion security patch; found ${patched.version}.`);
}

console.log(`Patched Pi Coding Agent brace-expansion to ${fixedVersion}.`);

async function readPackage(directory) {
  const content = await fs.readFile(path.join(directory, "package.json"), "utf8");
  const value = JSON.parse(content);
  if (typeof value.version !== "string") throw new Error(`Missing package version at ${directory}.`);
  return value;
}
