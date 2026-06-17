import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const COMPONENTS_DIR = path.join(SRC, "components");
const RAW_RESPONSIVE_DIRS = ["app", "features", "layout"].map((dir) => path.join(SRC, dir));
const SHARED_UI_DIR = path.join(SRC, "shared", "ui");
const SHARED_CODE_INDEX = path.join(SRC, "shared", "code", "index.ts");
const FEATURES_DIR = path.join(SRC, "features");

const failures = [];

function walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function read(file) {
  return readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function report(file, message, evidence) {
  failures.push(`${rel(file)}: ${message}${evidence ? `\n  ${evidence}` : ""}`);
}

function assertComponentsAreBridges() {
  if (!exists(COMPONENTS_DIR)) return;
  const files = walkFiles(COMPONENTS_DIR);
  for (const file of files) {
    const content = read(file);
    const stripped = content.replace(/\/\/.*$/gm, "").trim();
    const exportBlocks = stripped.match(/export\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*)\s+from\s+["'][^"']+["'];?/g) ?? [];
    const remainder = exportBlocks.reduce(
      (current, block) => current.replace(block, ""),
      stripped,
    ).trim();
    const isBridge = exportBlocks.length > 0 && remainder.length === 0;

    if (!isBridge) {
      report(
        file,
        "src/components is frozen as a compatibility bridge; move implementation logic to features, shared, or layout.",
      );
      continue;
    }

    for (const block of exportBlocks) {
      const [, target] = /from\s+["']([^"']+)["']/.exec(block) ?? [];
      if (target && !isConvergedBridgeTarget(file, target)) {
        report(
          file,
          "components bridge files should point directly to converged owners, not to another components bridge.",
          `export target: ${target}`,
        );
      }
    }
  }
}

function assertNoNewComponentsImports() {
  const files = walkFiles(SRC).filter((file) => !isInside(file, COMPONENTS_DIR));
  const importPattern = /from\s+["']([^"']*components[^"']*)["']/g;

  for (const file of files) {
    const content = read(file);
    for (const match of content.matchAll(importPattern)) {
      report(
        file,
        "new code should not import from components/* bridge paths.",
        `import target: ${match[1]}`,
      );
    }
  }
}

function assertNoRawResponsiveChecks() {
  const forbiddenPatterns = [
    /\bwindow\.matchMedia\b/,
    /\bglobalThis\.matchMedia\b/,
    /\bwindow\.innerWidth\b/,
    /\bwindow\.outerWidth\b/,
    /\bscreen\.width\b/,
  ];

  for (const dir of RAW_RESPONSIVE_DIRS) {
    if (!exists(dir)) continue;
    for (const file of walkFiles(dir)) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const content = read(file);
      for (const pattern of forbiddenPatterns) {
        const match = pattern.exec(content);
        if (match) {
          report(
            file,
            "use shared/responsive capabilities instead of raw viewport or media-query checks.",
            `matched: ${match[0]}`,
          );
        }
      }
    }
  }
}

function assertSharedUiIsDomainNeutral() {
  if (!exists(SHARED_UI_DIR)) return;
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

  for (const file of walkFiles(SHARED_UI_DIR)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const content = read(file);
    for (const pattern of forbiddenPatterns) {
      const match = pattern.exec(content);
      if (match) {
        report(
          file,
          "shared/ui primitives must stay domain-neutral; keep chat/session/workflow semantics in features.",
          `matched: ${match[0]}`,
        );
      }
    }
  }
}

function assertSharedCodeLazyEntrypointsStayExplicit() {
  if (!exists(SHARED_CODE_INDEX)) return;
  const content = read(SHARED_CODE_INDEX);
  const forbiddenExports = [
    /MarkdownRenderer/,
    /LazyMarkdownRenderer/,
  ];

  for (const pattern of forbiddenExports) {
    const match = pattern.exec(content);
    if (match) {
      report(
        SHARED_CODE_INDEX,
        "MarkdownRenderer and LazyMarkdownRenderer must stay off the shared/code barrel to preserve code splitting.",
        `matched: ${match[0]}`,
      );
    }
  }
}

function assertFeatureCrossImportsUseExplicitEntrypoints() {
  if (!exists(FEATURES_DIR)) return;
  const featureDirs = readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const featureName of featureDirs) {
    const featureDir = path.join(FEATURES_DIR, featureName);
    for (const file of walkFiles(featureDir)) {
      const content = read(file);
      for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
        const target = match[1];
        if (!target.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), target);
        const importedFeature = featureDirs.find((name) => {
          if (name === featureName) return false;
          return resolved === path.join(FEATURES_DIR, name);
        });
        if (importedFeature) {
          report(
            file,
            "cross-feature imports should use explicit sub-entrypoints instead of another feature's barrel.",
            `import target: ${target}`,
          );
        }
      }
    }
  }
}

function exists(file) {
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

function isInside(file, dir) {
  const relative = path.relative(dir, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isConvergedBridgeTarget(file, target) {
  if (target.startsWith("@/")) {
    return /^@\/(?:features|shared|layout)\//.test(target);
  }
  if (!target.startsWith(".")) {
    return false;
  }

  const resolved = path.resolve(path.dirname(file), target);
  return [
    path.join(SRC, "features"),
    path.join(SRC, "shared"),
    path.join(SRC, "layout"),
  ].some((ownerDir) => resolved === ownerDir || isInside(resolved, ownerDir));
}

assertComponentsAreBridges();
assertNoNewComponentsImports();
assertNoRawResponsiveChecks();
assertSharedUiIsDomainNeutral();
assertSharedCodeLazyEntrypointsStayExplicit();
assertFeatureCrossImportsUseExplicitEntrypoints();

if (failures.length > 0) {
  console.error("Frontend architecture check failed:\n");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Frontend architecture check passed.");
