import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

interface ComplexityBudget {
  sourceRoots: string[];
  fileExtensions: string[];
  ignoredGlobs: string[];
  lineBudget: {
    maxLines: number;
    legacyAllowance: number;
  };
  legacyLargeFiles: LegacyLargeFileBudget[];
  directoryBudgets: DirectoryBudget[];
  requiredModuleGuides: string[];
}

interface LegacyLargeFileBudget {
  path: string;
  baselineLines: number;
  owner: string;
  splitTarget: string;
}

interface DirectoryBudget {
  path: string;
  maxRootFiles: number;
  message: string;
}

interface SourceFileMetric {
  path: string;
  lines: number;
}

const workspaceRoot = process.cwd();
const budgetPath = path.join(workspaceRoot, "Scripts", "ComplexityBudget.json");
const budget = readBudget();
const sourceFiles = readSourceFileMetrics();
const sourceFilesByPath = new Map(sourceFiles.map((file) => [file.path, file]));
const legacyBudgetsByPath = new Map(budget.legacyLargeFiles.map((entry) => [normalizePath(entry.path), entry]));

const violations = [
  ...inspectRequiredGuides(),
  ...inspectLegacyBudgets(),
  ...inspectLargeFiles(),
  ...inspectDirectoryBudgets(),
];

assert.deepEqual(
  violations,
  [],
  [
    "Complexity budget verification failed.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"),
);

console.log([
  "Complexity budget verified",
  `(${sourceFiles.length} files,`,
  `${budget.legacyLargeFiles.length} legacy large-file budgets).`,
].join(" "));

function inspectRequiredGuides(): string[] {
  return budget.requiredModuleGuides
    .filter((guide) => !fs.existsSync(path.join(workspaceRoot, guide)))
    .map((guide) => `${guide} must exist as a module guide.`);
}

function inspectLegacyBudgets(): string[] {
  return budget.legacyLargeFiles.flatMap((entry) => {
    const budgetedPath = normalizePath(entry.path);
    const file = sourceFilesByPath.get(budgetedPath);
    if (!file) {
      return [
        `${entry.path} legacy large-file budget references a missing or ignored source file.`,
      ];
    }
    if (file.lines <= budget.lineBudget.maxLines) {
      return [
        [
          `${entry.path} has ${file.lines} lines, within normal budget ${budget.lineBudget.maxLines}.`,
          "Remove this legacyLargeFiles entry.",
        ].join(" "),
      ];
    }
    if (entry.baselineLines > file.lines) {
      return [
        [
          `${entry.path} legacy baseline is stale.`,
          `baseline=${entry.baselineLines}, current=${file.lines}.`,
          "Lower baselineLines to the current line count so the budget ratchets down after splits.",
        ].join(" "),
      ];
    }
    return [];
  });
}

function inspectLargeFiles(): string[] {
  return sourceFiles.flatMap((file) => {
    const legacyBudget = legacyBudgetsByPath.get(file.path);
    if (legacyBudget) {
      const maxLines = legacyBudget.baselineLines + budget.lineBudget.legacyAllowance;
      return file.lines <= maxLines
        ? []
        : [
          [
            `${file.path} has ${file.lines} lines, above legacy budget ${maxLines}.`,
            `baseline=${legacyBudget.baselineLines}, allowance=${budget.lineBudget.legacyAllowance}.`,
            `owner=${legacyBudget.owner}.`,
            legacyBudget.splitTarget,
          ].join(" "),
        ];
    }

    return file.lines <= budget.lineBudget.maxLines
      ? []
      : [
        [
          `${file.path} has ${file.lines} lines, above budget ${budget.lineBudget.maxLines}.`,
          "Split the file or add an explicit legacyLargeFiles entry with owner and splitTarget.",
        ].join(" "),
      ];
  });
}

function inspectDirectoryBudgets(): string[] {
  return budget.directoryBudgets.flatMap((entry) => {
    const directory = path.join(workspaceRoot, entry.path);
    const rootFiles = fs.readdirSync(directory, { withFileTypes: true })
      .filter((item) => item.isFile() && budget.fileExtensions.includes(path.extname(item.name)))
      .length;

    return rootFiles <= entry.maxRootFiles
      ? []
      : [
        [
          `${entry.path} has ${rootFiles} root source files, above budget ${entry.maxRootFiles}.`,
          entry.message,
        ].join(" "),
      ];
  });
}

function readSourceFileMetrics(): SourceFileMetric[] {
  const patterns = budget.sourceRoots.map((root) => `${root.replaceAll("\\", "/")}/**/*`);
  return fg.sync(patterns, {
    cwd: workspaceRoot,
    absolute: false,
    onlyFiles: true,
    unique: true,
    ignore: budget.ignoredGlobs,
  })
    .filter((file) => budget.fileExtensions.includes(path.extname(file)))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      path: normalizePath(file),
      lines: countLines(path.join(workspaceRoot, file)),
    }));
}

function countLines(file: string): number {
  const text = fs.readFileSync(file, "utf8");
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r\n|\r|\n/).length;
}

function readBudget(): ComplexityBudget {
  const parsed = JSON.parse(fs.readFileSync(budgetPath, "utf8")) as ComplexityBudget;
  assert.ok(Array.isArray(parsed.sourceRoots), "ComplexityBudget.json must define sourceRoots.");
  assert.ok(Array.isArray(parsed.fileExtensions), "ComplexityBudget.json must define fileExtensions.");
  assert.ok(Array.isArray(parsed.ignoredGlobs), "ComplexityBudget.json must define ignoredGlobs.");
  assert.ok(parsed.lineBudget, "ComplexityBudget.json must define lineBudget.");
  assert.ok(Array.isArray(parsed.legacyLargeFiles), "ComplexityBudget.json must define legacyLargeFiles.");
  assert.ok(Array.isArray(parsed.directoryBudgets), "ComplexityBudget.json must define directoryBudgets.");
  assert.ok(Array.isArray(parsed.requiredModuleGuides), "ComplexityBudget.json must define requiredModuleGuides.");
  assert.equal(
    parsed.legacyLargeFiles.length,
    new Set(parsed.legacyLargeFiles.map((entry) => normalizePath(entry.path))).size,
    "ComplexityBudget.json legacyLargeFiles paths must be unique.",
  );
  for (const entry of parsed.legacyLargeFiles) {
    assert.ok(entry.path, "ComplexityBudget.json legacyLargeFiles entries must define path.");
    assert.ok(Number.isInteger(entry.baselineLines), `${entry.path} must define integer baselineLines.`);
    assert.ok(entry.baselineLines > parsed.lineBudget.maxLines, `${entry.path} baselineLines must exceed maxLines.`);
    assert.ok(entry.owner, `${entry.path} must define owner.`);
    assert.ok(entry.splitTarget, `${entry.path} must define splitTarget.`);
  }
  return parsed;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
