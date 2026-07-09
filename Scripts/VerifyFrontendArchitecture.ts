import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const workspaceRoot = resolveWorkspaceRoot();
const frontendRoot = path.join(workspaceRoot, "Frontend");
const srcRoot = path.join(frontendRoot, "src");

const sourceExtensions = new Set([".ts", ".tsx"]);
const componentsDir = path.join(srcRoot, "components");
const rawResponsiveDirs = ["app", "features", "layout"].map((dir) => path.join(srcRoot, dir));
const sharedUiDir = path.join(srcRoot, "shared", "ui");
const sharedCodeIndex = path.join(srcRoot, "shared", "code", "index.ts");
const featuresDir = path.join(srcRoot, "features");
const failures: string[] = [];

assertLegacyComponentsDirectoryRemoved();
assertNoComponentsImports();
assertNoRawResponsiveChecks();
assertSharedUiIsDomainNeutral();
assertSharedCodeLazyEntrypointsStayExplicit();
assertFeatureCrossImportsUseExplicitEntrypoints();
assertFeatureCodeDoesNotUseLowLevelDrawerMotion();

assert.deepEqual(failures, [], `Frontend architecture check failed:\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
console.log("Frontend architecture check passed.");

function assertLegacyComponentsDirectoryRemoved(): void {
  if (exists(componentsDir)) {
    report(
      componentsDir,
      "src/components compatibility bridge has been retired; use features, shared, or layout ownership directly.",
    );
  }
}

function assertNoComponentsImports(): void {
  const importPattern = /from\s+["']([^"']*components[^"']*)["']/g;
  for (const file of walkFiles(srcRoot).filter((entry) => !isInside(entry, componentsDir))) {
    const content = read(file);
    for (const match of content.matchAll(importPattern)) {
      report(file, "code should not import from retired components/* bridge paths.", `import target: ${match[1]}`);
    }
  }
}

function assertNoRawResponsiveChecks(): void {
  const forbiddenPatterns = [
    /\bwindow\.matchMedia\b/,
    /\bglobalThis\.matchMedia\b/,
    /\bwindow\.innerWidth\b/,
    /\bwindow\.outerWidth\b/,
    /\bscreen\.width\b/,
  ];

  for (const dir of rawResponsiveDirs) {
    if (!exists(dir)) continue;
    for (const file of walkFiles(dir)) {
      const content = read(file);
      for (const pattern of forbiddenPatterns) {
        const match = pattern.exec(content);
        if (match) {
          report(file, "use shared/responsive capabilities instead of raw viewport or media-query checks.", `matched: ${match[0]}`);
        }
      }
    }
  }
}

function assertSharedUiIsDomainNeutral(): void {
  if (!exists(sharedUiDir)) return;
  const forbiddenPatterns = [
    /from\s+["'][^"']*(?:features|store|api)\//,
    /\bChatMessage\b/,
    /\bSessionRecord\b/,
    /\bRunRecord\b/,
    /\bTimelineStep\b/,
    /\bsessionId\b/,
    /\brequestId\b/,
    /\bworkflow\b/i,
  ];

  for (const file of walkFiles(sharedUiDir)) {
    const content = read(file);
    for (const pattern of forbiddenPatterns) {
      const match = pattern.exec(content);
      if (match) {
        report(file, "shared/ui primitives must stay domain-neutral; keep chat/session/workflow semantics in features.", `matched: ${match[0]}`);
      }
    }
  }
}

function assertSharedCodeLazyEntrypointsStayExplicit(): void {
  if (!exists(sharedCodeIndex)) return;
  const content = read(sharedCodeIndex);
  for (const pattern of [/MarkdownRenderer/, /LazyMarkdownRenderer/]) {
    const match = pattern.exec(content);
    if (match) {
      report(
        sharedCodeIndex,
        "MarkdownRenderer and LazyMarkdownRenderer must stay off the shared/code barrel to preserve code splitting.",
        `matched: ${match[0]}`,
      );
    }
  }
}

function assertFeatureCrossImportsUseExplicitEntrypoints(): void {
  if (!exists(featuresDir)) return;
  const featureDirs = readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const featureName of featureDirs) {
    const featureDir = path.join(featuresDir, featureName);
    for (const file of walkFiles(featureDir)) {
      const content = read(file);
      for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
        const target = match[1];
        if (!target?.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), target);
        const importedFeature = featureDirs.find((name) =>
          name !== featureName && resolved === path.join(featuresDir, name));
        if (importedFeature) {
          report(file, "cross-feature imports should use explicit sub-entrypoints instead of another feature's barrel.", `import target: ${target}`);
        }
      }
    }
  }
}

function assertFeatureCodeDoesNotUseLowLevelDrawerMotion(): void {
  if (!exists(featuresDir)) return;
  const forbiddenNames = [
    "readDrawerVariants",
    "readOverlayVariants",
    "MotionSheetContent",
    "MotionDialogOverlay",
  ];

  for (const file of walkFiles(featuresDir)) {
    const content = read(file);
    for (const name of forbiddenNames) {
      if (new RegExp(`\\b${name}\\b`).test(content)) {
        report(file, "feature code should use shared/ui Sheet or Dialog instead of low-level overlay/drawer motion primitives.", `matched: ${name}`);
      }
    }
  }
}

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    try {
      readdirSync(file);
      return true;
    } catch {
      return false;
    }
  }
}

function isInside(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function report(file: string, message: string, evidence?: string): void {
  failures.push(`${relativePath(file)}: ${message}${evidence ? `\n  ${evidence}` : ""}`);
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
