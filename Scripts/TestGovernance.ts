import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { TestSuitePolicy } from "./TestCoveragePolicy.js";

const ignoredDirectories = new Set(["node_modules", "dist", "build"]);

export type TestGovernanceOptions = {
  workspaceRoot: string;
  policy: TestSuitePolicy;
};

export function verifyTestGovernance(options: TestGovernanceOptions): number {
  const testRoot = resolvePolicyPath(options.workspaceRoot, options.policy.testRoot);
  const sourceRoot = resolvePolicyPath(options.workspaceRoot, options.policy.sourceRoot);
  const testFiles = walkFiles(testRoot)
    .filter((file) => options.policy.testFilePattern.test(file))
    .sort((left, right) => left.localeCompare(right));
  const testSources = new Map(testFiles.map((file) => [file, readFileSync(file, "utf8")]));

  assert.ok(
    testFiles.length >= (options.policy.requiredLayers?.length ?? 1),
    `Expected ${options.policy.label} tests across configured layers, found ${testFiles.length}.`,
  );
  assertTestFilesDeclareCases(options, testSources);
  assertRequiredLayers(options.policy, testRoot, testFiles, testSources);
  assertTestFilesStayInScripts(options, sourceRoot, testRoot);
  assertLayerImportRules(options, testRoot, testFiles, testSources);
  assertCoveragePolicy(options.policy);

  return testFiles.length;
}

export function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "Frontend", "src")) && existsSync(path.join(cwd, "Source"))) {
    return cwd;
  }
  const parent = path.resolve(cwd, "..");
  if (existsSync(path.join(parent, "Frontend", "src")) && existsSync(path.join(parent, "Source"))) {
    return parent;
  }
  return cwd;
}

function assertRequiredLayers(
  policy: TestSuitePolicy,
  testRoot: string,
  testFiles: readonly string[],
  testSources: ReadonlyMap<string, string>,
): void {
  const violations = (policy.requiredLayers ?? []).flatMap((layer) => {
    const layerFiles = testFiles.filter((file) => isUnderTestLayer(testRoot, file, layer.name));
    if (layerFiles.length === 0) {
      return [`${layer.name} has no test files`];
    }

    const cases = layerFiles.reduce((count, file) => count + countVitestCaseCalls(testSources.get(file) ?? ""), 0);
    return layer.minimumCases !== undefined && cases < layer.minimumCases
      ? [`${layer.name} has ${cases} cases, requires ${layer.minimumCases}`]
      : [];
  });
  assert.deepEqual(violations, [], `${policy.label} test layer requirements failed: ${violations.join("; ")}`);
}

function assertTestFilesDeclareCases(options: TestGovernanceOptions, testSources: ReadonlyMap<string, string>): void {
  const filesWithoutCases = [...testSources.entries()]
    .filter(([, source]) => countVitestCaseCalls(source) === 0)
    .map(([file]) => relativePath(options.workspaceRoot, file));
  assert.deepEqual(
    filesWithoutCases,
    [],
    `${options.policy.label} test files must declare at least one Vitest test case.`,
  );
}

function assertTestFilesStayInScripts(options: TestGovernanceOptions, sourceRoot: string, testRoot: string): void {
  const localTests = walkFiles(sourceRoot)
    .filter((file) => options.policy.sourceLocalTestPattern.test(file))
    .map((file) => relativePath(options.workspaceRoot, file))
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual(
    localTests,
    [],
    `${options.policy.label} verification tests must live under ${relativePath(options.workspaceRoot, testRoot)}.`,
  );
}

function assertLayerImportRules(
  options: TestGovernanceOptions,
  testRoot: string,
  testFiles: readonly string[],
  testSources: ReadonlyMap<string, string>,
): void {
  const violations = testFiles.flatMap((file) => {
    const layer = (options.policy.requiredLayers ?? []).find((candidate) =>
      isUnderTestLayer(testRoot, file, candidate.name),
    );
    const forbiddenImports = layer?.forbidsImportsFrom ?? [];
    if (forbiddenImports.length === 0) {
      return [];
    }

    const imports = readStaticImports(testSources.get(file) ?? "");
    const relative = relativePath(options.workspaceRoot, file);
    return imports
      .filter((target) => forbiddenImports.some((prefix) => normalizePath(target).includes(prefix)))
      .map((target) => `${relative} imports forbidden layer target: ${target}`);
  });
  assert.deepEqual(violations, [], `${options.policy.label} test layer import rules failed.`);
}

function assertCoveragePolicy(policy: TestSuitePolicy): void {
  if (!hasCoveragePolicy(policy)) {
    return;
  }
  assert.ok(
    policy.coverageInclude.length > 0,
    `${policy.label} coverage policy must include at least one source glob.`,
  );
  assert.ok(policy.coverageExclude.length > 0, `${policy.label} coverage policy must declare exclusions.`);
  for (const [metric, value] of Object.entries(policy.thresholds)) {
    assert.ok(
      Number.isInteger(value) && value >= 0 && value <= 100,
      `${policy.label} coverage threshold ${metric} must be 0-100.`,
    );
  }
  for (const group of policy.thresholdGroups ?? []) {
    assert.ok(group.pattern.length > 0, `${policy.label} grouped coverage threshold must define a pattern.`);
    for (const [metric, value] of Object.entries(group.thresholds)) {
      assert.ok(
        Number.isInteger(value) && value >= 0 && value <= 100,
        `${policy.label} grouped coverage threshold ${group.pattern}:${metric} must be 0-100.`,
      );
    }
  }
}

function hasCoveragePolicy(policy: TestSuitePolicy): policy is TestSuitePolicy & {
  coverageInclude: readonly string[];
  coverageExclude: readonly string[];
  thresholds: Record<string, number>;
  thresholdGroups?: readonly {
    pattern: string;
    thresholds: Record<string, number>;
  }[];
} {
  return (
    "coverageInclude" in policy &&
    Array.isArray(policy.coverageInclude) &&
    "coverageExclude" in policy &&
    Array.isArray(policy.coverageExclude) &&
    "thresholds" in policy &&
    typeof policy.thresholds === "object" &&
    policy.thresholds !== null
  );
}

function readStaticImports(source: string): string[] {
  const sourceFile = parseTestSource(source);
  const moduleSpecifiers: string[] = [];

  const recordModuleSpecifier = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) {
      moduleSpecifiers.push(node.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      recordModuleSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return moduleSpecifiers;
}

function countVitestCaseCalls(source: string): number {
  const sourceFile = parseTestSource(source);
  let cases = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isVitestCaseExpression(node.expression)) {
      cases += 1;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return cases;
}

function isVitestCaseExpression(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "test" || expression.text === "it";
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return isVitestCaseExpression(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    return isVitestCaseExpression(expression.expression);
  }
  return false;
}

function parseTestSource(source: string): ts.SourceFile {
  return ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function isUnderTestLayer(testRoot: string, file: string, layer: string): boolean {
  return path.relative(testRoot, file).split(path.sep)[0] === layer;
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

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function relativePath(workspaceRoot: string, file: string): string {
  return path.relative(workspaceRoot, file).replaceAll(path.sep, "/");
}

function resolvePolicyPath(workspaceRoot: string, value: string): string {
  return path.resolve(workspaceRoot, ...value.split("/"));
}
