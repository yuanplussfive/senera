import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export interface I18nRuntimeGovernanceArea {
  root: string;
  include: readonly string[];
  allowedFiles?: readonly string[];
  exclude?: readonly string[];
}

export interface I18nRuntimeGovernanceOptions {
  workspaceRoot: string;
  areas: readonly I18nRuntimeGovernanceArea[];
}

const HanTextPattern = /\p{Script=Han}/u;
const RuntimeSourcePattern = /\.(ts|tsx)$/u;
const IgnoredDirectoryNames = new Set(["node_modules", "dist", "build"]);

const UserVisibleCalleeNames = new Set([
  "agentErrorMessage",
  "frontendMessage",
  "formatAgentMessage",
  "formatFrontendMessage",
  "readAgentErrorMessageTemplate",
]);

const UserVisiblePropertyNames = new Set([
  "aria-label",
  "confirmLabel",
  "description",
  "details",
  "emptyText",
  "errorMessage",
  "label",
  "message",
  "placeholder",
  "recommendation",
  "suggestion",
  "subtitle",
  "text",
  "title",
  "tooltip",
]);

export function verifyI18nRuntimeGovernance(options: I18nRuntimeGovernanceOptions): void {
  const violations = options.areas.flatMap((area) => inspectArea(options.workspaceRoot, area));
  assert.deepEqual(
    violations,
    [],
    ["Runtime i18n governance failed.", ...violations.map((violation) => `- ${violation}`)].join("\n"),
  );
}

function inspectArea(workspaceRoot: string, area: I18nRuntimeGovernanceArea): string[] {
  const root = path.resolve(workspaceRoot, ...area.root.split("/"));
  const allowedFiles = new Set(
    (area.allowedFiles ?? []).map((file) => normalizePath(path.resolve(workspaceRoot, ...file.split("/")))),
  );
  const excludedPaths = (area.exclude ?? []).map((file) => normalizePath(path.resolve(root, ...file.split("/"))));

  return area.include
    .flatMap((include) => collectSourceFiles(path.resolve(root, ...include.split("/"))))
    .filter((file, index, files) => files.indexOf(file) === index)
    .filter((file) => !allowedFiles.has(normalizePath(file)))
    .filter(
      (file) =>
        !excludedPaths.some(
          (excluded) => normalizePath(file) === excluded || normalizePath(file).startsWith(`${excluded}/`),
        ),
    )
    .flatMap((file) => inspectFile(workspaceRoot, file));
}

function inspectFile(workspaceRoot: string, file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      recordIfRuntimeText(node, compactJsxText(node.getText(sourceFile)), "JSX text");
    } else if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      recordStringLiteral(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      recordTemplate(node);
    }
    ts.forEachChild(node, visit);
  };

  const recordIfRuntimeText = (node: ts.Node, value: string, reason: string): void => {
    if (!HanTextPattern.test(value) || isInsideI18nCall(node) || isTypeOnlyContext(node)) {
      return;
    }
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(
      `${relativePath(workspaceRoot, file)}:${location.line + 1}:${location.character + 1} ${reason} must use i18n catalog`,
    );
  };

  const recordStringLiteral = (node: ts.StringLiteralLike | ts.NoSubstitutionTemplateLiteral, value: string): void => {
    if (!isUserVisibleString(node)) {
      return;
    }
    recordIfRuntimeText(node, value, "runtime string");
  };

  const recordTemplate = (node: ts.TemplateExpression): void => {
    if (!isUserVisibleString(node)) {
      return;
    }
    const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
    recordIfRuntimeText(node, text, "runtime template");
  };

  visit(sourceFile);
  return violations;
}

function isUserVisibleString(node: ts.Node): boolean {
  if (isInsideImportOrExport(node) || isInsideI18nCall(node) || isTypeOnlyContext(node)) {
    return false;
  }

  let current = node.parent;
  while (current && isTransparentExpressionWrapper(current)) {
    current = current.parent;
  }
  if (!current) {
    return false;
  }

  if (ts.isJsxAttribute(current)) {
    return UserVisiblePropertyNames.has(readJsxAttributeName(current.name));
  }

  if (ts.isPropertyAssignment(current)) {
    return isUserVisiblePropertyName(current.name);
  }

  if (ts.isCallExpression(current)) {
    return isUserVisibleCall(current);
  }

  if (ts.isNewExpression(current) && isIdentifierText(current.expression, "Error")) {
    return true;
  }

  if (ts.isArrayLiteralExpression(current)) {
    return isArrayAssignedToUserVisibleProperty(current);
  }

  return false;
}

function isTransparentExpressionWrapper(node: ts.Node): boolean {
  return (
    ts.isConditionalExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isJsxExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTemplateExpression(node)
  );
}
function isUserVisibleCall(node: ts.CallExpression): boolean {
  const expression = node.expression;
  if (isIdentifierText(expression, "frontendMessage") || isIdentifierText(expression, "agentErrorMessage")) {
    return false;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const method = expression.name.text;
    if (
      method === "error" ||
      method === "warning" ||
      method === "success" ||
      method === "message" ||
      method === "info"
    ) {
      return true;
    }
  }
  if (ts.isPropertyAssignment(node.parent)) {
    return isUserVisiblePropertyName(node.parent.name);
  }
  return isIdentifierText(expression, "confirm") || isIdentifierText(expression, "alert");
}

function isArrayAssignedToUserVisibleProperty(node: ts.ArrayLiteralExpression): boolean {
  const parent = node.parent;
  return ts.isPropertyAssignment(parent) && isUserVisiblePropertyName(parent.name);
}

function isUserVisiblePropertyName(name: ts.PropertyName): boolean {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return UserVisiblePropertyNames.has(name.text);
  }
  return false;
}

function readJsxAttributeName(name: ts.JsxAttributeName): string {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return `${name.namespace.text}:${name.name.text}`;
}

function isInsideI18nCall(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && isKnownI18nCallee(current.expression)) {
      return true;
    }
  }
  return false;
}

function isKnownI18nCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return UserVisibleCalleeNames.has(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return UserVisibleCalleeNames.has(expression.name.text);
  }
  return false;
}

function isInsideImportOrExport(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) {
      return true;
    }
  }
  return false;
}

function isTypeOnlyContext(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (
      ts.isTypeNode(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isLiteralTypeNode(current)
    ) {
      return true;
    }
  }
  return false;
}

function isIdentifierText(expression: ts.Expression, text: string): boolean {
  return ts.isIdentifier(expression) && expression.text === text;
}

function collectSourceFiles(target: string): string[] {
  if (!fs.existsSync(target)) {
    return [];
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return RuntimeSourcePattern.test(target) ? [target] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && IgnoredDirectoryNames.has(entry.name)) {
      continue;
    }
    files.push(...collectSourceFiles(path.join(target, entry.name)));
  }
  return files;
}

function compactJsxText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function relativePath(workspaceRoot: string, file: string): string {
  return path.relative(workspaceRoot, file).replaceAll(path.sep, "/");
}
