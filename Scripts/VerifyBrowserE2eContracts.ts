import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { toPosixRelative, walkFiles } from "./Support/FileWalk.js";

const workspaceRoot = process.cwd();
const testRoot = path.join(workspaceRoot, "Scripts", "BrowserE2ETests");
const configSource = readSource("playwright.config.ts");
const harnessSource = readSource("Scripts/BrowserE2ETests/browserE2eTest.mjs");
const desktopHarnessSource = readSource("Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs");
const verifyWorkflowSource = readSource(".github/workflows/verify.yml");
const testFiles = walkFiles(testRoot, { extensions: [".spec.mjs"] });
const frontendTestFiles = walkFiles(path.join(workspaceRoot, "Scripts", "FrontendTests"), { extensions: [".mjs"] });
const violations: string[] = [];

assert.ok(configSource.includes('name: "chromium"'), "Playwright must define the Chromium project.");
assert.ok(configSource.includes('name: "electron"'), "Playwright must define the Electron desktop project.");
assert.ok(!configSource.includes('name: "firefox"'), "PR browser E2E must not install or run Firefox.");
assert.ok(!configSource.includes('name: "webkit"'), "PR browser E2E must not install or run WebKit.");
assert.ok(configSource.includes('trace: "retain-on-failure"'), "Playwright must retain traces only on failure.");
assert.ok(configSource.includes('video: "off"'), "Playwright video must remain disabled by default.");
assert.ok(testFiles.length > 0, "Browser E2E requires at least one Playwright spec.");
assert.ok(
  harnessSource.includes('"disabled" | "required"'),
  "Browser E2E harness must expose disabled and required authentication modes.",
);
assert.ok(
  desktopHarnessSource.includes('Apps", "Desktop", "Preload.cjs"'),
  "Desktop Browser E2E must load the production Electron preload bridge.",
);
assert.ok(
  verifyWorkflowSource.includes(
    `node -p "'version=' + require('@playwright/test/package.json').version" >> "$GITHUB_OUTPUT"`,
  ),
  "Chromium Browser E2E must resolve the Playwright cache version without nested shell command quoting.",
);

let caseCount = 0;
let browserTestSource = "";
for (const testFile of testFiles) {
  const source = fs.readFileSync(testFile, "utf8");
  browserTestSource += `\n${source}`;
  const relative = toPosixRelative(workspaceRoot, testFile);
  caseCount += countTestCases(source);
  for (const forbidden of ["Frontend/src/", "Source/AgentSystem/", "useStore", "waitForTimeout", "NodeWebSocket"]) {
    if (source.includes(forbidden)) violations.push(`${relative} uses forbidden browser-test shortcut: ${forbidden}`);
  }
  if (mutatesRuntimeConfig(source)) {
    violations.push(`${relative} injects browser runtime configuration instead of exercising the served contract.`);
  }
}

for (const frontendTestFile of frontendTestFiles) {
  const source = fs.readFileSync(frontendTestFile, "utf8");
  const relative = toPosixRelative(workspaceRoot, frontendTestFile);
  for (const forbidden of ["toHaveFocus(", "fireEvent.contextMenu(", "{Shift>}{F10}{/Shift}"]) {
    if (source.includes(forbidden)) {
      violations.push(`${relative} asserts a real-browser interaction in jsdom: ${forbidden}`);
    }
  }
}

for (const [contract, marker] of [
  ["real focus", "toBeFocused()"],
  ["Portal ownership", 'closest("[data-session-sidebar]")'],
  ["keyboard context menu", 'press("Shift+F10")'],
  ["keyboard dismissal", 'press("Escape")'],
] as const) {
  assert.ok(browserTestSource.includes(marker), `Browser E2E must cover ${contract}.`);
}

function mutatesRuntimeConfig(source: string): boolean {
  const sourceFile = ts.createSourceFile("browser.spec.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isRuntimeConfigReference(node.left)
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ((node.expression.name.text === "assign" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Object" &&
        node.arguments.some(isRuntimeConfigReference)) ||
        node.expression.name.text === "addInitScript")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isRuntimeConfigReference(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) return isRuntimeConfigReference(node.expression);
  if (ts.isPropertyAccessExpression(node)) {
    return isBrowserGlobal(node.expression) && node.name.text === "__SENERA_RUNTIME_CONFIG__";
  }
  if (ts.isElementAccessExpression(node) && isBrowserGlobal(node.expression)) {
    return (
      ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "__SENERA_RUNTIME_CONFIG__"
    );
  }
  return false;
}

function isBrowserGlobal(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && (node.text === "window" || node.text === "globalThis");
}

assert.ok(caseCount >= 10, `Browser E2E requires at least 10 cases, found ${caseCount}.`);
assert.deepEqual(violations, [], ["Browser E2E contract verification failed.", ...violations].join("\n"));
console.log(`Browser E2E contracts verified (${testFiles.length} files, ${caseCount} cases).`);

function countTestCases(source: string): number {
  const sourceFile = ts.createSourceFile("browser.spec.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let cases = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "test") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "test" &&
          node.expression.name.text === "skip"))
    ) {
      cases += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return cases;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}
