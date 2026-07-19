import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const write = args.includes("--write");
const from = readOption("--from");
const to = readOption("--to");

if ((from && !to) || (!from && to)) {
  console.error("VerifyChangedFormatting requires both --from and --to when checking a git range.");
  process.exit(2);
}

const files = from && to ? readRangeFiles(from, to) : readWorkingTreeFiles();
if (files.length === 0) {
  console.log("Prettier: no changed files to check.");
  process.exit(0);
}

const prettierEntrypoint = path.join(workspaceRoot, "node_modules", "prettier", "bin", "prettier.cjs");
if (!fs.existsSync(prettierEntrypoint)) {
  console.error(`Prettier entrypoint not found: ${prettierEntrypoint}`);
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [prettierEntrypoint, write ? "--write" : "--check", "--ignore-unknown", ...files],
  {
    cwd: workspaceRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  console.error(`Unable to run Prettier: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length) || undefined;
}

function readRangeFiles(rangeFrom: string, rangeTo: string): string[] {
  return runGit(["diff", "--name-only", "--diff-filter=ACMR", "-z", rangeFrom, rangeTo]);
}

function readWorkingTreeFiles(): string[] {
  return unique([
    ...runGit(["diff", "--name-only", "--diff-filter=ACMR", "-z"]),
    ...runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]),
    ...runGit(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
}

function runGit(gitArgs: readonly string[]): string[] {
  const result = spawnSync("git", gitArgs, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(
      `Unable to read changed files from git: ${result.error?.message ?? result.stderr ?? "unknown error"}`,
    );
    process.exit(2);
  }
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
