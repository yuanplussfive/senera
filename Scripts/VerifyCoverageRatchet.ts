import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import {
  CoverageMetricNames,
  coverageRatchetPath,
  readCoverageRatchet,
  writeCoverageRatchet,
  type CoverageMetricName,
  type CoverageRatchetThresholds,
} from "./CoverageRatchetStore.js";
import { ProjectTestCoveragePolicies } from "./TestCoveragePolicy.js";
import { toPosixPath } from "./Support/FileWalk.js";
import { resolveWorkspaceRoot } from "./WorkspaceRoot.js";

interface CoverageMetricSummary {
  total: number;
  covered: number;
  pct: number;
}

type CoverageFileSummary = Record<CoverageMetricName, CoverageMetricSummary>;

type CoverageSummaryReport = Record<string, CoverageFileSummary>;

interface CoverageScope {
  suiteName: string;
  scopeLabel: string;
  thresholds: CoverageRatchetThresholds;
  actuals: CoverageRatchetThresholds;
}

const applyMode = process.argv.includes("--apply");
const workspaceRoot = resolveWorkspaceRoot();
const ratchetFile = coverageRatchetPath(workspaceRoot);
const ratchet = readCoverageRatchet(ratchetFile);

assert.deepEqual(
  Object.keys(ratchet.suites).sort(),
  Object.keys(ProjectTestCoveragePolicies).sort(),
  "CoverageRatchet.json suites must match ProjectTestCoveragePolicies exactly.",
);

const scopes = Object.entries(ProjectTestCoveragePolicies).flatMap(([suiteName, policy]) =>
  collectSuiteScopes(suiteName, policy.coverageDirectory),
);

if (applyMode) {
  applyRatchet(scopes);
} else {
  verifyRatchet(scopes);
}

function verifyRatchet(coverageScopes: readonly CoverageScope[]): void {
  const allowance = ratchet.ratchet.improvementAllowancePercent;
  const violations = coverageScopes.flatMap((scope) =>
    CoverageMetricNames.flatMap((metric) => {
      const threshold = scope.thresholds[metric];
      const actual = scope.actuals[metric];
      if (actual < threshold) {
        return [
          `${describeScope(scope)} ${metric} coverage ${formatPercent(actual)} fell below the ratcheted threshold ${threshold}%.`,
        ];
      }
      if (actual - threshold > allowance) {
        return [
          [
            `${describeScope(scope)} ${metric} coverage ${formatPercent(actual)} exceeds threshold ${threshold}%`,
            `by more than the ${allowance}% allowance.`,
            "Run npm run quality.coverage.ratchet.apply to lock in the improvement.",
          ].join(" "),
        ];
      }
      return [];
    }),
  );

  assert.deepEqual(
    violations,
    [],
    ["Coverage ratchet verification failed.", ...violations.map((violation) => `- ${violation}`)].join("\n"),
  );
  console.log(`Coverage ratchet verified (${coverageScopes.length} scopes, allowance ${allowance}%).`);
}

function applyRatchet(coverageScopes: readonly CoverageScope[]): void {
  const margin = ratchet.ratchet.raiseMarginPercent;
  const regressions: string[] = [];
  const raises: string[] = [];

  for (const scope of coverageScopes) {
    for (const metric of CoverageMetricNames) {
      const threshold = scope.thresholds[metric];
      const actual = scope.actuals[metric];
      if (actual < threshold) {
        regressions.push(
          `${describeScope(scope)} ${metric} coverage ${formatPercent(actual)} is below the ratcheted threshold ${threshold}%.`,
        );
        continue;
      }
      const next = Math.min(100, Math.max(threshold, Math.floor(actual - margin)));
      if (next > threshold) {
        scope.thresholds[metric] = next;
        raises.push(`${describeScope(scope)} ${metric}: ${threshold}% -> ${next}% (actual ${formatPercent(actual)})`);
      }
    }
  }

  assert.deepEqual(
    regressions,
    [],
    [
      "Coverage ratchet cannot be applied while coverage sits below existing thresholds.",
      ...regressions.map((regression) => `- ${regression}`),
    ].join("\n"),
  );

  if (raises.length === 0) {
    console.log("Coverage ratchet already tight; no thresholds raised.");
    return;
  }
  writeCoverageRatchet(ratchet, ratchetFile);
  console.log(["Coverage ratchet raised:", ...raises.map((raise) => `- ${raise}`)].join("\n"));
}

function collectSuiteScopes(suiteName: string, coverageDirectory: string): CoverageScope[] {
  const suite = ratchet.suites[suiteName];
  assert.ok(suite, `CoverageRatchet.json must define suite ${suiteName}.`);
  const summary = readCoverageSummary(coverageDirectory);
  const totalScope: CoverageScope = {
    suiteName,
    scopeLabel: "total",
    thresholds: suite.total,
    actuals: metricPercents(summary, (entry) => entry.total),
  };
  const groupScopes = Object.entries(suite.groups).map(([pattern, thresholds]) => ({
    suiteName,
    scopeLabel: pattern,
    thresholds,
    actuals: aggregateGroupActuals(summary, pattern),
  }));
  return [totalScope, ...groupScopes];
}

function readCoverageSummary(coverageDirectory: string): CoverageSummaryReport {
  const summaryPath = path.join(workspaceRoot, coverageDirectory, "coverage-summary.json");
  assert.ok(
    fs.existsSync(summaryPath),
    `${path.relative(workspaceRoot, summaryPath)} is missing. Run npm run quality.coverage first.`,
  );
  return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as CoverageSummaryReport;
}

function aggregateGroupActuals(summary: CoverageSummaryReport, pattern: string): CoverageRatchetThresholds {
  const matchedFiles = new Set(fg.sync(pattern, { cwd: workspaceRoot, absolute: false }).map(toPosixPath));
  assert.ok(matchedFiles.size > 0, `Coverage ratchet group pattern matches no files on disk: ${pattern}`);

  const counts = new Map<CoverageMetricName, { total: number; covered: number }>(
    CoverageMetricNames.map((metric) => [metric, { total: 0, covered: 0 }]),
  );
  let matchedEntries = 0;
  for (const [file, entry] of Object.entries(summary)) {
    if (file === "total" || !matchedFiles.has(toPosixPath(path.relative(workspaceRoot, file)))) {
      continue;
    }
    matchedEntries += 1;
    for (const metric of CoverageMetricNames) {
      const bucket = counts.get(metric)!;
      bucket.total += entry[metric].total;
      bucket.covered += entry[metric].covered;
    }
  }
  assert.ok(matchedEntries > 0, `Coverage summary contains no entries for group pattern: ${pattern}`);

  return Object.fromEntries(
    CoverageMetricNames.map((metric) => {
      const bucket = counts.get(metric)!;
      return [metric, bucket.total === 0 ? 100 : (bucket.covered / bucket.total) * 100];
    }),
  ) as CoverageRatchetThresholds;
}

function metricPercents(
  summary: CoverageSummaryReport,
  select: (summary: CoverageSummaryReport) => CoverageFileSummary,
): CoverageRatchetThresholds {
  const entry = select(summary);
  assert.ok(entry, "Coverage summary must include a total entry.");
  return Object.fromEntries(
    CoverageMetricNames.map((metric) => [metric, entry[metric].pct]),
  ) as CoverageRatchetThresholds;
}

function describeScope(scope: CoverageScope): string {
  return scope.scopeLabel === "total" ? `${scope.suiteName} total` : `${scope.suiteName} group ${scope.scopeLabel}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}
