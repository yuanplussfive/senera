import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import { toPosixRelative } from "./Support/FileWalk.js";

interface VerifySuitesConfig {
  defaultSuite: string;
  suites: Record<string, VerifySuiteDefinition>;
}

interface VerifySuiteDefinition {
  description: string;
  includes?: string[];
  patterns?: string[];
}

const workspaceRoot = process.cwd();
const configPath = path.join(workspaceRoot, "Scripts", "VerifySuites.json");
const distScriptsRoot = path.join(workspaceRoot, "Dist", "Scripts");
const commandArguments = process.argv.slice(2);
const shouldListSuites = commandArguments.includes("--list");
const shouldListScripts = commandArguments.includes("--list-scripts");
const suiteNames = commandArguments.filter((argument) => argument !== "--list" && argument !== "--list-scripts");
const config = readConfig();
const selectedSuites = suiteNames.length > 0 ? suiteNames : [config.defaultSuite];

void main();

async function main(): Promise<void> {
  if (shouldListSuites) {
    listSuites();
    return;
  }

  assert.ok(
    fs.existsSync(distScriptsRoot),
    [
      `Compiled verification scripts were not found at ${toPosixRelative(workspaceRoot, distScriptsRoot)}.`,
      "Run npm run build before invoking verifysuite directly.",
    ].join("\n"),
  );

  const scripts = resolveSuiteScripts(selectedSuites);
  assert.ok(scripts.length > 0, `No verification scripts matched suites: ${selectedSuites.join(", ")}`);

  if (shouldListScripts) {
    for (const script of scripts) console.log(toPosixRelative(workspaceRoot, script));
    return;
  }

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

function resolveSuiteScripts(names: readonly string[], ancestors: readonly string[] = []): string[] {
  const scripts: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    assert.ok(!ancestors.includes(name), `Circular verification suites: ${[...ancestors, name].join(" -> ")}`);
    const suite = config.suites[name];
    assert.ok(suite, `Unknown verification suite: ${name}`);
    assert.ok(suite.includes?.length || suite.patterns?.length, `Verification suite ${name} must not be empty.`);
    const included = resolveSuiteScripts(suite.includes ?? [], [...ancestors, name]);
    const matched = suite.patterns ? resolveSuiteDefinition(name, suite.patterns) : [];
    for (const script of [...included, ...matched]) {
      if (seen.has(script)) {
        continue;
      }
      seen.add(script);
      scripts.push(script);
    }
  }

  return scripts;
}

function resolveSuiteDefinition(name: string, patterns: readonly string[]): string[] {
  assert.ok(Array.isArray(patterns), `Verification suite ${name} must define patterns.`);

  const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludePatterns = patterns.filter((pattern) => pattern.startsWith("!"));
  assert.ok(includePatterns.length > 0, `Verification suite ${name} must include at least one script pattern.`);

  const scripts: string[] = [];
  const unresolvedPatterns: string[] = [];

  for (const includePattern of includePatterns) {
    const matches = globSync([includePattern, ...excludePatterns], {
      cwd: distScriptsRoot,
      absolute: true,
      onlyFiles: true,
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
