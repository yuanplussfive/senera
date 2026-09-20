import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

const workspaceRoot = resolveWorkspaceRoot();
const srcRoot = path.join(workspaceRoot, "Frontend", "src");
const featuresRoot = path.join(srcRoot, "features");
const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["build", "dist", "node_modules"]);
const staticScanTimeoutMs = 15_000;
const iconVendorPackages = [
  "lucide-react",
  "iconoir-react",
  "@heroicons/react",
  "@hugeicons/react",
  "@hugeicons/core-free-icons",
  "react-icons",
  "@tabler/icons-react",
  "@phosphor-icons/react",
  "@iconify/react",
  "@radix-ui/react-icons",
];
const iconAdapterPath = "Frontend/src/shared/ui/AppIcon.tsx";

test(
  "source tree has no retired root components bridge or imports",
  () => {
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
  },
  staticScanTimeoutMs,
);

test(
  "shadcn intake remains transient and isolated from production source",
  () => {
    const incomingRoot = path.join(srcRoot, "shared", "ui", "_incoming");
    const violations = [
      ...(existsSync(incomingRoot)
        ? sourceFiles(incomingRoot).map((file) => formatViolation(file, "commits transient shadcn intake source"))
        : []),
      ...sourceFiles(srcRoot).flatMap((file) =>
        staticImportTargets(file)
          .filter((target) => targetsIncomingUiRoot(file, target, incomingRoot))
          .map((target) => formatViolation(file, "imports transient shadcn intake source", target)),
      ),
    ];

    expect(violations).toEqual([]);
  },
  staticScanTimeoutMs,
);

test(
  "new production icon imports stay behind the shared AppIcon adapter",
  () => {
    const baseline = resolveIconImportBaseline();
    if (!baseline.repositoryAvailable) {
      expect([]).toEqual([]);
      return;
    }

    const changedFiles = changedProductionSourceFiles(baseline.ref);
    const baselineSources = readGitFiles(
      baseline.ref,
      changedFiles.map((file) => relativePath(file)),
    );
    const violations = changedFiles.flatMap((file) => {
      if (relativePath(file) === iconAdapterPath) return [];

      const currentImports = iconImportRecords(readFileSync(file, "utf8"), file);
      if (currentImports.length === 0) return [];

      const baselineSource = baselineSources.get(relativePath(file));
      const baselineImports = baselineSource ? iconImportRecords(baselineSource, file) : [];
      return currentImports
        .filter((current) => !baselineImports.some((previous) => importRecordCovers(previous, current)))
        .map((current) =>
          formatViolation(file, "adds a direct icon vendor import; use shared/ui/AppIcon", current.target),
        );
    });

    expect(violations).toEqual([]);
  },
  staticScanTimeoutMs,
);

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

test("loading motion uses the shared semantic classes", () => {
  const forbidden = [/motion-safe:animate-(?:pulse|spin)/, /\banimate-(?:pulse|spin)\b/];

  expect(scanPatterns([srcRoot].filter(existsSync), forbidden, "uses an ad hoc loading animation class")).toEqual([]);
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
  return staticImportTargetsFromSource(readFileSync(file, "utf8"), file);
}

function staticImportTargetsFromSource(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
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

function iconImportRecords(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const records = [];

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier) && isIconVendor(moduleSpecifier.text)) {
        records.push({
          target: moduleSpecifier.text,
          shape: ts.isImportDeclaration(node) ? importShape(node) : undefined,
        });
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      isIconVendor(node.arguments[0].text)
    ) {
      records.push({ target: node.arguments[0].text, shape: undefined });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}

function importShape(node) {
  const clause = node.importClause;
  if (!clause) {
    return { defaultImport: undefined, namespaceImport: undefined, namedImports: [] };
  }

  const namedBindings = clause.namedBindings;
  return {
    defaultImport: clause.name?.text,
    namespaceImport: namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name.text : undefined,
    namedImports:
      namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements
            .map((element) => ({
              imported: element.propertyName?.text ?? element.name.text,
              local: element.name.text,
              typeOnly: element.isTypeOnly,
            }))
            .sort((left, right) =>
              `${left.imported}:${left.local}:${left.typeOnly}`.localeCompare(
                `${right.imported}:${right.local}:${right.typeOnly}`,
              ),
            )
        : [],
  };
}

function isIconVendor(target) {
  return iconVendorPackages.some((vendor) => target === vendor || target.startsWith(`${vendor}/`));
}

function importRecordCovers(previous, current) {
  if (previous.target !== current.target) return false;
  if (!previous.shape || !current.shape) return !previous.shape && !current.shape;

  if (current.shape.defaultImport && current.shape.defaultImport !== previous.shape.defaultImport) return false;
  if (current.shape.namespaceImport && current.shape.namespaceImport !== previous.shape.namespaceImport) return false;

  const previousNamed = new Set(
    previous.shape.namedImports.map((item) => `${item.imported}:${item.local}:${item.typeOnly}`),
  );
  return current.shape.namedImports.every((item) =>
    previousNamed.has(`${item.imported}:${item.local}:${item.typeOnly}`),
  );
}

function changedProductionSourceFiles(ref) {
  const changed = runGit(["diff", "--name-only", ref, "--", "Frontend/src"])
    ?.split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => path.join(workspaceRoot, file))
    .filter((file) => existsSync(file) && sourceExtensions.has(path.extname(file)))
    .filter((file) => {
      const normalized = relativePath(file);
      return !normalized.includes("/dev/") && !normalized.endsWith(".stories.tsx");
    });

  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", "Frontend/src"])
    ?.split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => path.join(workspaceRoot, file))
    .filter((file) => existsSync(file) && sourceExtensions.has(path.extname(file)))
    .filter((file) => {
      const normalized = relativePath(file);
      return !normalized.includes("/dev/") && !normalized.endsWith(".stories.tsx");
    });

  return [...new Set([...(changed ?? []), ...(untracked ?? [])])];
}

function resolveIconImportBaseline() {
  const repositoryAvailable = runGit(["rev-parse", "--show-toplevel"]) !== undefined;
  if (!repositoryAvailable) {
    return { repositoryAvailable: false, dirty: false, ref: "HEAD" };
  }

  const dirty = Boolean(runGit(["status", "--porcelain", "--untracked-files=all"])?.trim());
  const parentRef = runGit(["rev-parse", "--verify", "HEAD^"])?.trim();
  return { repositoryAvailable: true, dirty, ref: dirty || !parentRef ? "HEAD" : "HEAD^" };
}

function readGitFiles(ref, files) {
  const requested = files.filter(Boolean);
  if (requested.length === 0) return new Map();

  try {
    const output = execFileSync("git", ["cat-file", "--batch"], {
      cwd: workspaceRoot,
      input: `${requested.map((file) => `${ref}:${file}`).join("\n")}\n`,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const sources = new Map();
    let offset = 0;
    for (const file of requested) {
      const headerEnd = output.indexOf(10, offset);
      if (headerEnd < 0) break;
      const header = output.subarray(offset, headerEnd).toString("utf8");
      offset = headerEnd + 1;
      const [, type, sizeText] = header.split(" ");
      if (type !== "blob") continue;
      const size = Number(sizeText);
      sources.set(file, output.subarray(offset, offset + size).toString("utf8"));
      offset += size;
      if (output[offset] === 10) offset += 1;
    }
    return sources;
  } catch {
    return new Map();
  }
}

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
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

function targetsIncomingUiRoot(file, target, incomingRoot) {
  if (target === "@/shared/ui/_incoming" || target.startsWith("@/shared/ui/_incoming/")) {
    return true;
  }
  if (!target.startsWith(".")) {
    return false;
  }

  return pathIsInsideOrEqual(path.resolve(path.dirname(file), target), incomingRoot);
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
