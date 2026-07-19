import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { resolveWorkspaceRoot } from "./TestGovernance.js";

const workspaceRoot = resolveWorkspaceRoot();
const frontendRoot = path.join(workspaceRoot, "Frontend");
const sharedUiRoot = path.join(frontendRoot, "src", "shared", "ui");
const publicIndexPath = path.join(sharedUiRoot, "index.ts");
const configPath = path.join(frontendRoot, ".ladle", "config.mjs");
const providerPath = path.join(frontendRoot, ".ladle", "components.tsx");
const nonVisualModuleExemptions = new Set(["./useClipboardCopy"]);

verifyLadleConfig();
verifyGlobalProvider();
verifyPublicComponentStories();
verifyChineseStoryCopy();
verifySwitchCopy();

console.log("Frontend Ladle contracts verified.");

function verifyLadleConfig(): void {
  const source = readFileSync(configPath, "utf8");
  const sourceFile = parseSource(configPath, source, ts.ScriptKind.JS);
  const exportedObject = sourceFile.statements
    .filter(ts.isExportAssignment)
    .map((statement) => statement.expression)
    .find(ts.isObjectLiteralExpression);

  assert.ok(exportedObject, "Frontend/.ladle/config.mjs must default-export a configuration object.");
  assert.equal(readStringProperty(exportedObject, "stories"), "src/**/*.stories.{tsx,ts}");
  assert.equal(readStringProperty(exportedObject, "viteConfig"), "./vite.config.ts");

  const addons = readObjectProperty(exportedObject, "addons");
  const width = addons && readObjectProperty(addons, "width");
  const options = width && readObjectProperty(width, "options");
  assert.ok(options, "Ladle must define the project viewport review presets.");
  assert.deepEqual(readNumberRecord(options), {
    "手机": 390,
    "紧凑桌面": 900,
    "标准桌面": 1280,
    "宽屏桌面": 1440,
    "超宽桌面": 1600,
  });
}

function verifyGlobalProvider(): void {
  const source = readFileSync(providerPath, "utf8");
  const sourceFile = parseSource(providerPath, source, ts.ScriptKind.TSX);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
    return ts.isStringLiteralLike(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [];
  });

  assert.ok(imports.includes("../src/index.css"), "Ladle Provider must load the real src/index.css.");
  assert.ok(
    imports.includes("../src/shared/theme/themeModel"),
    "Ladle Provider must create tokens through the real theme model.",
  );
}

function verifyPublicComponentStories(): void {
  const source = readFileSync(publicIndexPath, "utf8");
  const sourceFile = parseSource(publicIndexPath, source, ts.ScriptKind.TS);
  const publicVisualModules = sourceFile.statements
    .filter(ts.isExportDeclaration)
    .filter(hasRuntimeExport)
    .flatMap((statement) => {
      return statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [];
    })
    .filter((moduleName) => !nonVisualModuleExemptions.has(moduleName));

  const violations: string[] = [];
  for (const moduleName of [...new Set(publicVisualModules)].sort()) {
    const componentName = path.posix.basename(moduleName);
    const storyPath = path.join(sharedUiRoot, `${componentName}.stories.tsx`);
    if (!existsSync(storyPath)) {
      violations.push(`${componentName}: missing ${componentName}.stories.tsx`);
      continue;
    }

    const storySource = readFileSync(storyPath, "utf8");
    const storyFile = parseSource(storyPath, storySource, ts.ScriptKind.TSX);
    const importsRealModule = storyFile.statements.filter(ts.isImportDeclaration).some((statement) => {
      return ts.isStringLiteralLike(statement.moduleSpecifier) && statement.moduleSpecifier.text === moduleName;
    });
    if (!importsRealModule) {
      violations.push(`${componentName}: Story must import the real component from ${moduleName}`);
    }
  }

  assert.deepEqual(violations, [], `Frontend public component Story contracts failed:\n${violations.join("\n")}`);
}

function verifyChineseStoryCopy(): void {
  const storyFiles = walkStoryFiles(path.join(frontendRoot, "src"));
  const withoutChinese = storyFiles
    .filter((file) => !/[\u3400-\u9fff]/u.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(workspaceRoot, file).replaceAll(path.sep, "/"));

  assert.deepEqual(withoutChinese, [], "Every Ladle Story must contain Chinese visible copy.");
}

function verifySwitchCopy(): void {
  const storyFiles = walkStoryFiles(path.join(frontendRoot, "src"));
  const forbiddenCopy = /已启用|已关闭|\bON\b|\bOFF\b/u;
  const violations = storyFiles
    .filter((file) => forbiddenCopy.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(workspaceRoot, file).replaceAll(path.sep, "/"));

  assert.deepEqual(violations, [], "Ladle stories must not repeat enabled/disabled copy beside switches.");
}

function hasRuntimeExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly) return false;
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function readStringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find((candidate): candidate is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    return (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) && candidate.name.text === name;
  });
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined;
}

function readObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = object.properties.find((candidate): candidate is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    return (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) && candidate.name.text === name;
  });
  return property && ts.isObjectLiteralExpression(property.initializer) ? property.initializer : undefined;
}

function readNumberRecord(object: ts.ObjectLiteralExpression): Record<string, number> {
  return Object.fromEntries(
    object.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) || !ts.isNumericLiteral(property.initializer)) return [];
      if (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name)) return [];
      return [[property.name.text, Number(property.initializer.text)]];
    }),
  );
}

function walkStoryFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkStoryFiles(fullPath);
    return entry.isFile() && /\.stories\.(?:tsx|ts)$/u.test(entry.name) ? [fullPath] : [];
  });
}

function parseSource(fileName: string, source: string, scriptKind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
}
