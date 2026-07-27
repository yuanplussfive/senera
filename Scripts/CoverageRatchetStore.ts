import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot } from "./WorkspaceRoot.js";

export const CoverageMetricNames = ["lines", "functions", "branches", "statements"] as const;

export type CoverageMetricName = (typeof CoverageMetricNames)[number];

export type CoverageRatchetThresholds = Record<CoverageMetricName, number>;

export interface CoverageRatchetSuite {
  total: CoverageRatchetThresholds;
  groups: Record<string, CoverageRatchetThresholds>;
}

export interface CoverageRatchetConfig {
  ratchet: {
    improvementAllowancePercent: number;
    raiseMarginPercent: number;
  };
  suites: Record<string, CoverageRatchetSuite>;
}

export function coverageRatchetPath(workspaceRoot = resolveWorkspaceRoot(import.meta.url)): string {
  return path.join(workspaceRoot, "Scripts", "CoverageRatchet.json");
}

export function readCoverageRatchet(filePath = coverageRatchetPath()): CoverageRatchetConfig {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CoverageRatchetConfig;
  assertCoverageRatchetShape(parsed, filePath);
  return parsed;
}

export function writeCoverageRatchet(config: CoverageRatchetConfig, filePath = coverageRatchetPath()): void {
  assertCoverageRatchetShape(config, filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function assertCoverageRatchetShape(config: CoverageRatchetConfig, filePath: string): void {
  const label = path.basename(filePath);
  assert.ok(config.ratchet, `${label} must define ratchet.`);
  assertPercent(config.ratchet.improvementAllowancePercent, `${label} ratchet.improvementAllowancePercent`);
  assertPercent(config.ratchet.raiseMarginPercent, `${label} ratchet.raiseMarginPercent`);
  assert.ok(
    config.ratchet.raiseMarginPercent < config.ratchet.improvementAllowancePercent,
    `${label} raiseMarginPercent must stay below improvementAllowancePercent so an applied ratchet immediately verifies.`,
  );
  assert.ok(config.suites && typeof config.suites === "object", `${label} must define suites.`);
  const suiteNames = Object.keys(config.suites);
  assert.ok(suiteNames.length > 0, `${label} must define at least one suite.`);
  for (const suiteName of suiteNames) {
    const suite = config.suites[suiteName];
    assert.ok(suite, `${label} suite ${suiteName} must be an object.`);
    assertThresholds(suite.total, `${label} suites.${suiteName}.total`);
    assert.ok(
      suite.groups && typeof suite.groups === "object",
      `${label} suites.${suiteName} must define groups (may be empty).`,
    );
    for (const [pattern, thresholds] of Object.entries(suite.groups)) {
      assert.ok(pattern.length > 0, `${label} suites.${suiteName} group patterns must be non-empty globs.`);
      assertThresholds(thresholds, `${label} suites.${suiteName}.groups["${pattern}"]`);
    }
  }
}

function assertThresholds(thresholds: CoverageRatchetThresholds, context: string): void {
  assert.ok(thresholds && typeof thresholds === "object", `${context} must be an object.`);
  const metricNames = Object.keys(thresholds).sort();
  assert.deepEqual(
    metricNames,
    [...CoverageMetricNames].sort(),
    `${context} must define exactly the metrics ${CoverageMetricNames.join(", ")}.`,
  );
  for (const metric of CoverageMetricNames) {
    assertPercent(thresholds[metric], `${context}.${metric}`);
  }
}

function assertPercent(value: number, context: string): void {
  assert.ok(Number.isInteger(value) && value >= 0 && value <= 100, `${context} must be an integer between 0 and 100.`);
}
