import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const workspaceRoot = resolveWorkspaceRoot();
const frontendSourceRoot = path.join(workspaceRoot, "Frontend", "src");
const frontendTestsRoot = path.join(workspaceRoot, "Scripts", "FrontendTests");
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "build",
]);

const testFiles = walkFiles(frontendTestsRoot)
  .filter((file) => /\.test\.mjs$/.test(file))
  .sort((left, right) => left.localeCompare(right));

assert.ok(testFiles.length >= 9, `Expected at least 9 maintained frontend test files across state/api/store/feature layers, found ${testFiles.length}.`);

const testText = testFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const requiredEventKinds = [
  "AssistantMessageCreated",
  "ToolCallResultDetail",
  "SessionHistoryStarted",
  "SessionHistoryChunk",
  "SessionHistoryCompleted",
  "ApprovalRequested",
  "ApprovalResolved",
];

const missingEventKinds = requiredEventKinds
  .filter((kind) => !testText.includes(`EventKinds.${kind}`))
  .sort((left, right) => left.localeCompare(right));
assert.deepEqual(missingEventKinds, [], `Frontend projector tests are missing required event coverage: ${missingEventKinds.join(", ")}`);

assertRequiredLayers();
assertLayerImportRules();
assertRequiredCoverageTerms();

const frontendLocalTests = walkFiles(frontendSourceRoot)
  .filter((file) => /\.test\.(ts|tsx)$/.test(file))
  .map(relativePath)
  .sort((left, right) => left.localeCompare(right));
assert.deepEqual(frontendLocalTests, [], "Frontend verification tests must live under Scripts/FrontendTests.");

console.log(`Frontend test scope verified (${testFiles.length} Vitest files).`);

function assertRequiredLayers(): void {
  const layers = new Map([
    ["State", (file: string) => isUnderTestLayer(file, "State") || isLegacyStateTest(file)],
    ["Api", (file: string) => isUnderTestLayer(file, "Api")],
    ["Store", (file: string) => isUnderTestLayer(file, "Store")],
    ["Feature", (file: string) => isUnderTestLayer(file, "Feature")],
  ]);

  const missing = [...layers.entries()]
    .filter(([, predicate]) => !testFiles.some(predicate))
    .map(([layer]) => layer);
  assert.deepEqual(missing, [], `Frontend tests are missing required layers: ${missing.join(", ")}`);
}

function assertLayerImportRules(): void {
  const violations = testFiles.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    const relative = relativePath(file);
    const isState = isUnderTestLayer(file, "State") || isLegacyStateTest(file);

    if (isState) {
      return imports
        .filter((target) => target.includes("Frontend/src/features") || target.includes("Frontend/src/app"))
        .map((target) => `${relative} imports UI/application code from a state test: ${target}`);
    }

    return [];
  });
  assert.deepEqual(violations, [], "Frontend test layer import rules failed.");
}

function assertRequiredCoverageTerms(): void {
  const requiredCoverage = [
    "streamingEventCoalescer",
    "useAgentSocket",
    "useStore",
    "ApprovalRequestStrip",
    "ChatHeader",
    "EmptyChatState",
    "CodeArtifactSourceView",
    "CodeArtifactModel",
    "modelProvider",
    "messagePresentation",
    "stepPresentation",
    "runSummary",
    "canvasLoadPolicy",
    "responsive",
    "motion",
    "renderToStaticMarkup",
  ];
  const missing = requiredCoverage
    .filter((term) => !testText.includes(term))
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(missing, [], `Frontend tests are missing required module coverage: ${missing.join(", ")}`);
}

function isUnderTestLayer(file: string, layer: string): boolean {
  return path.relative(frontendTestsRoot, file).split(path.sep)[0] === layer;
}

function isLegacyStateTest(file: string): boolean {
  return path.dirname(file) === frontendTestsRoot;
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativePath(file: string): string {
  return path.relative(workspaceRoot, file).replaceAll(path.sep, "/");
}

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "Frontend", "src"))) {
    return cwd;
  }
  const parent = path.resolve(cwd, "..");
  if (existsSync(path.join(parent, "Frontend", "src"))) {
    return parent;
  }
  return cwd;
}
