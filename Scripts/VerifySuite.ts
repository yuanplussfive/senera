import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

interface VerifySuitesConfig {
  defaultSuite: string;
  suites: Record<string, VerifySuiteDefinition>;
}

interface VerifySuiteDefinition {
  description: string;
  patterns: string[];
}

const workspaceRoot = process.cwd();
const configPath = path.join(workspaceRoot, "Scripts", "VerifySuites.json");
const distScriptsRoot = path.join(workspaceRoot, "Dist", "Scripts");
const commandArguments = process.argv.slice(2);
const shouldListSuites = commandArguments.includes("--list");
const suiteNames = commandArguments.filter((argument) => argument !== "--list");
const config = readConfig();
const selectedSuites = suiteNames.length > 0 ? suiteNames : [config.defaultSuite];

void main();

async function main(): Promise<void> {
  if (shouldListSuites) {
    listSuites();
    return;
  }

  assert.ok(fs.existsSync(distScriptsRoot), [
    `Compiled verification scripts were not found at ${relativePath(distScriptsRoot)}.`,
    "Run npm run build before invoking verifysuite directly.",
  ].join("\n"));

  const scripts = resolveSuiteScripts(selectedSuites);
  assert.ok(scripts.length > 0, `No verification scripts matched suites: ${selectedSuites.join(", ")}`);

  for (const script of scripts) {
    await runScript(script);
  }

  console.log(`Verification suites passed: ${selectedSuites.join(", ")} (${scripts.length} scripts).`);
}

function readConfig(): VerifySuitesConfig {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<VerifySuitesConfig>;
  assert.ok(parsed.defaultSuite, "VerifySuites.json must define defaultSuite.");
  assert.ok(parsed.suites, "VerifySuites.json must define suites.");
  assert.ok(parsed.suites[parsed.defaultSuite], `defaultSuite is not defined: ${parsed.defaultSuite}`);
  return parsed as VerifySuitesConfig;
}

function listSuites(): void {
  console.log("Available verification suites:");
  for (const [name, suite] of Object.entries(config.suites)) {
    const marker = name === config.defaultSuite ? " (default)" : "";
    console.log(`- ${name}${marker}: ${suite.description}`);
  }
}

function resolveSuiteScripts(names: readonly string[]): string[] {
  const scripts: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const suite = config.suites[name];
    assert.ok(suite, `Unknown verification suite: ${name}`);
    for (const script of resolveSuiteDefinition(name, suite)) {
      if (seen.has(script)) {
        continue;
      }
      seen.add(script);
      scripts.push(script);
    }
  }

  return scripts;
}

function resolveSuiteDefinition(name: string, suite: VerifySuiteDefinition): string[] {
  assert.ok(Array.isArray(suite.patterns), `Verification suite ${name} must define patterns.`);

  const includePatterns = suite.patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludePatterns = suite.patterns.filter((pattern) => pattern.startsWith("!"));
  assert.ok(includePatterns.length > 0, `Verification suite ${name} must include at least one script pattern.`);

  const scripts: string[] = [];
  const unresolvedPatterns: string[] = [];

  for (const includePattern of includePatterns) {
    const matches = fg.sync([includePattern, ...excludePatterns], {
      cwd: distScriptsRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
    }).sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

    if (matches.length === 0) {
      unresolvedPatterns.push(includePattern);
      continue;
    }

    scripts.push(...matches);
  }

  assert.deepEqual(
    unresolvedPatterns,
    [],
    `Verification suite ${name} contains unresolved script patterns: ${unresolvedPatterns.join(", ")}`,
  );

  return scripts;
}

async function runScript(scriptPath: string): Promise<void> {
  const relativeScript = path.relative(workspaceRoot, scriptPath);
  console.log(`[verify] ${relativeScript}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: workspaceRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${relativeScript} failed with code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  });
}

function relativePath(value: string): string {
  return path.relative(workspaceRoot, value).replaceAll(path.sep, "/");
}
