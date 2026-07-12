import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

const workspaceRoot = resolveWorkspaceRoot();
const srcRoot = path.join(workspaceRoot, "Frontend", "src");
const featuresRoot = path.join(srcRoot, "features");
const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["build", "dist", "node_modules"]);

test("source tree has no retired root components bridge or imports", () => {
  const retiredComponentsRoot = path.join(srcRoot, "components");
  const violations = [
    ...(existsSync(retiredComponentsRoot)
      ? [formatViolation(retiredComponentsRoot, "retired src/components bridge still exists")]
      : []),
    ...sourceFiles(srcRoot).flatMap((file) =>
      staticImportTargets(file)
        .filter((target) => targetsRetiredComponentsRoot(file, target, retiredComponentsRoot))
        .map((target) => formatViolation(file, "imports retired components bridge", target)),
    ),
  ];

  expect(violations).toEqual([]);
});

test("responsive decisions go through shared responsive capabilities", () => {
  const responsiveOwnedRoots = ["app", "features", "layout"]
    .map((segment) => path.join(srcRoot, segment))
    .filter(existsSync);
  const forbidden = [
    /\bwindow\.matchMedia\b/,
    /\bglobalThis\.matchMedia\b/,
    /\bwindow\.innerWidth\b/,
    /\bwindow\.outerWidth\b/,
    /\bscreen\.width\b/,
  ];

  expect(scanPatterns(responsiveOwnedRoots, forbidden, "uses raw viewport or media-query state")).toEqual([]);
});

test("shared UI primitives stay domain-neutral", () => {
  const sharedUiRoot = path.join(srcRoot, "shared", "ui");
  const forbidden = [
    /from\s+["'][^"']*(?:features|store|api)\//,
    /\bChatMessage\b/,
    /\bSessionRecord\b/,
    /\bRunRecord\b/,
    /\bTimelineStep\b/,
    /\bsessionId\b/,
    /\brequestId\b/,
    /\bworkflow\b/i,
  ];

  expect(scanPatterns([sharedUiRoot].filter(existsSync), forbidden, "leaks feature or session semantics")).toEqual([]);
});

test("shared code barrel keeps heavy lazy renderers out of eager chunks", () => {
  const sharedCodeIndex = path.join(srcRoot, "shared", "code", "index.ts");
  if (!existsSync(sharedCodeIndex)) {
    expect([]).toEqual([]);
    return;
  }

  expect(
    matchPatterns(sharedCodeIndex, [/MarkdownRenderer/, /LazyMarkdownRenderer/], "exports heavy markdown renderer"),
  ).toEqual([]);
});

test("feature modules import other features through explicit sub-entrypoints", () => {
  const featureNames = listChildDirectories(featuresRoot);
  const violations = featureNames.flatMap((featureName) => {
    const featureRoot = path.join(featuresRoot, featureName);
    return sourceFiles(featureRoot).flatMap((file) =>
      staticImportTargets(file)
        .filter((target) => targetsAnotherFeatureBarrel(file, target, featureName, featureNames))
        .map((target) => formatViolation(file, "imports another feature barrel", target)),
    );
  });

  expect(violations).toEqual([]);
});

test("feature modules use shared overlay abstractions instead of low-level motion primitives", () => {
  const forbidden = [
    /\breadDrawerVariants\b/,
    /\breadOverlayVariants\b/,
    /\bMotionSheetContent\b/,
    /\bMotionDialogOverlay\b/,
  ];

  expect(scanPatterns([featuresRoot].filter(existsSync), forbidden, "uses low-level overlay motion primitive")).toEqual(
    [],
  );
});

function staticImportTargets(file) {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const targets = [];

  const record = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      targets.push(node.text);
    }
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return targets;
}

function targetsRetiredComponentsRoot(file, target, retiredComponentsRoot) {
  if (target === "@/components" || target.startsWith("@/components/")) {
    return true;
  }
  if (!target.startsWith(".")) {
    return false;
  }

  return pathIsInsideOrEqual(path.resolve(path.dirname(file), target), retiredComponentsRoot);
}

function targetsAnotherFeatureBarrel(file, target, currentFeature, featureNames) {
  const candidate = resolveImportTarget(file, target);
  if (!candidate) {
    return false;
  }

  return featureNames
    .filter((featureName) => featureName !== currentFeature)
    .some((featureName) => {
      const featureRoot = path.join(featuresRoot, featureName);
      return candidate === featureRoot || candidate === path.join(featureRoot, "index");
    });
}

function resolveImportTarget(file, target) {
  if (target.startsWith("@/features/")) {
    return path.join(srcRoot, ...target.slice(2).split("/"));
  }
  if (target.startsWith(".")) {
    return path.resolve(path.dirname(file), target);
  }
  return undefined;
}

function scanPatterns(roots, patterns, message) {
  return roots.flatMap((root) => sourceFiles(root).flatMap((file) => matchPatterns(file, patterns, message)));
}

function matchPatterns(file, patterns, message) {
  const content = readFileSync(file, "utf8");
  return patterns.flatMap((pattern) => {
    const match = pattern.exec(content);
    return match ? [formatViolation(file, message, match[0])] : [];
  });
}

function sourceFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(entryPath);
    }
    return entry.isFile() && sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function listChildDirectories(root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function pathIsInsideOrEqual(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatViolation(file, message, evidence) {
  return `${relativePath(file)}: ${message}${evidence ? ` (${evidence})` : ""}`;
}

function relativePath(file) {
  return path.relative(workspaceRoot, file).replaceAll(path.sep, "/");
}

function resolveWorkspaceRoot() {
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
