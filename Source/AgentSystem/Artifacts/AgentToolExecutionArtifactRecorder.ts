import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { Liquid } from "liquidjs";
import type {
  ResolvedAgentArtifactsConfig,
} from "../Types/AgentConfigTypes.js";
import type {
  ToolArtifactConditionManifest,
  ToolArtifactEvidenceManifest,
  ToolArtifactEvidenceSlotManifest,
  ToolArtifactPolicyManifest,
  ToolArtifactWorkspaceManifest,
} from "../Types/PluginManifestTypes.js";
import type {
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
  ToolArtifactDeltaRecord,
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";
import {
  createAgentArtifactLocator,
} from "./AgentArtifactLocator.js";
import { createAgentEvidenceUri } from "./AgentEvidenceUri.js";
import { selectJsonValues } from "./AgentArtifactJsonSelector.js";
import { AgentWorkspaceArtifactWriter } from "./AgentWorkspaceArtifactWriter.js";

const ArtifactTemplateRenderer = new Liquid({
  strictFilters: true,
  strictVariables: false,
});
const EvidencePresentationRenderer = new Liquid({
  strictFilters: true,
  strictVariables: false,
});

export interface AgentToolExecutionArtifactRecorderOptions {
  workspaceRoot: string;
  config: ResolvedAgentArtifactsConfig;
}

export interface RecordToolArtifactsInput {
  requestId: string;
  step: number;
  results: readonly ExecutedToolCallResult[];
}

export class AgentToolExecutionArtifactRecorder {
  constructor(private readonly options: AgentToolExecutionArtifactRecorderOptions) {}

  async record(input: RecordToolArtifactsInput): Promise<ExecutedToolCallResult[]> {
    const previousEvidence = new Set<string>();
    const recorded: ExecutedToolCallResult[] = [];

    for (const [index, result] of input.results.entries()) {
      const artifact = await this.recordOne({
        requestId: input.requestId,
        step: input.step,
        callIndex: index + 1,
        result,
        previousEvidence,
      });
      artifact.evidence.forEach((entry) => previousEvidence.add(entry.key));
      recorded.push({
        ...result,
        artifact,
      });
    }

    return recorded;
  }

  private async recordOne(input: {
    requestId: string;
    step: number;
    callIndex: number;
    result: ExecutedToolCallResult;
    previousEvidence: Set<string>;
  }): Promise<ExecutedToolCallArtifact> {
    const argsHash = stableHash(input.result.arguments);
    const resultHash = stableHash(input.result.result);
    const locator = createAgentArtifactLocator({
      workspaceRoot: this.options.workspaceRoot,
      rootDir: this.options.config.RootDir,
      requestId: input.requestId,
      step: input.step,
      callIndex: input.callIndex,
      toolName: input.result.name,
      argsHash,
      resultHash,
    });
    const policy = input.result.artifactPolicy;
    const redactedInput = redactSecrets(input.result.arguments, policy);
    const redactedRaw = redactSecrets(input.result.result, policy);
    const evidence = collectEvidence(redactedRaw, policy, locator.artifactId);
    const workspaceArtifacts = input.result.workspaceCapture
      ? await writeWorkspaceArtifacts({
          workspaceRoot: this.options.workspaceRoot,
          policy,
          toolName: input.result.name,
          workspaceCapture: input.result.workspaceCapture,
          artifactDir: locator.absoluteDir,
          files: locator.files,
        })
      : undefined;
    const delta = [
      ...evidence.map((entry) => ({
        kind: "evidence",
        key: entry.key,
        status: input.previousEvidence.has(entry.key) ? "unchanged" : "added",
        summary: entry.label,
        metadata: {
          evidenceKind: entry.kind,
        },
      } satisfies ToolArtifactDeltaRecord)),
      ...(workspaceArtifacts?.changes ?? []).map((change) => ({
        kind: "workspace",
        key: change.path,
        status: change.status === "unchanged" ? "unchanged" : "changed",
        summary: `${change.status}: ${change.path}`,
        metadata: {
          beforeHash: change.beforeHash,
          afterHash: change.afterHash,
          beforeSize: change.beforeSize,
          afterSize: change.afterSize,
          patch: change.patch,
        },
      } satisfies ToolArtifactDeltaRecord)),
    ];
    const summary = buildSummary({
      toolName: input.result.name,
      callId: input.result.callId,
      args: redactedInput,
      result: redactedRaw,
      evidence,
      delta,
      policy,
      artifact: {
        artifactId: locator.artifactId,
        artifactUri: locator.artifactUri,
        artifactPath: locator.absoluteDir,
        relativePath: locator.relativeDir,
      },
      workspace: workspaceArtifacts
        ? {
            before: workspaceArtifacts.before,
            after: workspaceArtifacts.after,
            changes: workspaceArtifacts.changes,
          }
        : undefined,
      maxChars: this.options.config.SummaryMaxChars,
    });
    const artifact: ExecutedToolCallArtifact = {
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      artifactPath: locator.absoluteDir,
      relativePath: locator.relativeDir,
      manifestPath: locator.files.manifest,
      files: locator.files,
      summary,
      evidence,
      delta,
      workspace: workspaceArtifacts
        ? {
            before: workspaceArtifacts.before,
            after: workspaceArtifacts.after,
            changes: workspaceArtifacts.changes,
          }
        : undefined,
    };

    await fs.mkdir(locator.absoluteDir, { recursive: true });
    await writeJson(locator.files.manifest, {
      schemaVersion: 1,
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      workspaceRoot: locator.workspaceRoot,
      rootDir: locator.rootDir,
      absoluteDir: locator.absoluteDir,
      relativeDir: locator.relativeDir,
      requestId: input.requestId,
      step: input.step,
      callIndex: input.callIndex,
      toolName: input.result.name,
      callId: input.result.callId,
      argsHash,
      resultHash,
      process: input.result.process,
      workspace: workspaceArtifacts
        ? {
            beforeCount: workspaceArtifacts.before.files.length,
            afterCount: workspaceArtifacts.after.files.length,
            changeCount: workspaceArtifacts.changes.length,
            files: {
              before: locator.files.workspaceBefore,
              after: locator.files.workspaceAfter,
              diff: locator.files.workspaceDiff,
              patch: locator.files.workspacePatch,
              beforeDir: locator.files.workspaceBeforeDir,
              afterDir: locator.files.workspaceAfterDir,
            },
            patch: workspaceArtifacts.patch,
          }
        : undefined,
      files: locator.files,
    });
    await writeJson(locator.files.input, redactedInput);
    await writeBoundedJson(locator.files.raw, redactedRaw, this.options.config.RawJsonMaxBytes);
    await writeText(locator.files.summary, summary, this.options.config.TextFileMaxBytes);
    await writeJson(locator.files.evidence, {
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      artifactPath: locator.absoluteDir,
      evidence,
    });
    await writeText(
      locator.files.projection,
      buildProjection({
        artifact,
        toolName: input.result.name,
        callId: input.result.callId,
        args: redactedInput,
        result: redactedRaw,
        policy,
      }),
      this.options.config.TextFileMaxBytes,
    );
    await writeJson(locator.files.delta, {
      artifactId: locator.artifactId,
      artifactUri: locator.artifactUri,
      artifactPath: locator.absoluteDir,
      delta,
    });
    if (workspaceArtifacts) {
      await writeJson(locator.files.workspaceBefore, workspaceArtifacts.before);
      await writeJson(locator.files.workspaceAfter, workspaceArtifacts.after);
      await writeJson(locator.files.workspaceDiff, {
        artifactId: locator.artifactId,
        artifactUri: locator.artifactUri,
        artifactPath: locator.absoluteDir,
        patch: workspaceArtifacts.patch,
        changes: workspaceArtifacts.changes,
      });
    }

    return artifact;
  }
}

function buildSummary(input: {
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  evidence: readonly ToolArtifactEvidenceRecord[];
  delta: readonly ToolArtifactDeltaRecord[];
  policy: ToolArtifactPolicyManifest | undefined;
  artifact: Record<string, unknown>;
  workspace: unknown;
  maxChars: number;
}): string {
  const template = input.policy?.Summary?.Template;
  return template
    ? truncateText(renderArtifactTemplate(template, createArtifactTemplateScope(input)) ?? "", input.maxChars)
    : "";
}

function buildProjection(input: {
  artifact: ExecutedToolCallArtifact;
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  policy: ToolArtifactPolicyManifest | undefined,
}): string {
  const template = input.policy?.Summary?.ArtifactTemplate;
  return template
    ? renderArtifactTemplate(template, createArtifactTemplateScope({
        toolName: input.toolName,
        callId: input.callId,
        args: input.args,
        result: input.result,
        evidence: input.artifact.evidence,
        delta: input.artifact.delta,
        policy: input.policy,
        artifact: {
          artifactId: input.artifact.artifactId,
          artifactUri: input.artifact.artifactUri,
          artifactPath: input.artifact.artifactPath,
          relativePath: input.artifact.relativePath,
        },
        workspace: input.artifact.workspace,
      })) ?? ""
    : "";
}

function projectEvidenceForTemplate(entry: ToolArtifactEvidenceRecord): Record<string, unknown> {
  return {
    evidenceUri: entry.evidenceUri,
    kind: entry.kind,
    locator: entry.locator,
    display: entry.display,
    label: entry.label,
    source: entry.source,
    confidence: entry.confidence,
    slots: entry.slots ?? {},
    modelSlots: entry.modelSlots,
    metadata: entry.metadata ?? {},
  };
}

function createArtifactTemplateScope(input: {
  toolName: string;
  callId: string;
  args: unknown;
  result: unknown;
  evidence: readonly ToolArtifactEvidenceRecord[];
  delta: readonly ToolArtifactDeltaRecord[];
  policy: ToolArtifactPolicyManifest | undefined;
  artifact: Record<string, unknown>;
  workspace: unknown;
}): Record<string, unknown> {
  const evidence = input.evidence.map(projectEvidenceForTemplate);
  const projections = buildEvidenceProjectionBlocks(input.policy, evidence);
  return {
    toolName: input.toolName,
    callId: input.callId,
    arguments: input.args,
    result: input.result,
    artifact: input.artifact,
    evidence,
    evidenceByKind: Object.fromEntries(
      (input.policy?.Evidence ?? []).map((rule) => [
        rule.Kind,
        evidence.filter((entry) => entry.kind === rule.Kind),
      ]),
    ),
    projections,
    delta: input.delta,
    workspace: input.workspace,
  };
}

function buildEvidenceProjectionBlocks(
  policy: ToolArtifactPolicyManifest | undefined,
  evidence: readonly Record<string, unknown>[],
): Array<{
  kind: string;
  count: number;
  summary: string;
  artifact: string;
}> {
  return (policy?.Evidence ?? []).flatMap((rule) => {
    const records = evidence.filter((entry) => entry.kind === rule.Kind);
    if (records.length === 0) {
      return [];
    }

    const data = {
      kind: rule.Kind,
      count: records.length,
      evidence: records,
    };
    return [{
      kind: rule.Kind,
      count: records.length,
      summary: renderEvidenceTemplate(rule.Projection.SummaryTemplate, data) ?? "",
      artifact: renderEvidenceTemplate(rule.Projection.ArtifactTemplate, data) ?? "",
    }];
  });
}

function collectEvidence(
  value: unknown,
  policy: ToolArtifactPolicyManifest | undefined,
  artifactId: string,
): ToolArtifactEvidenceRecord[] {
  const evidence = new Map<string, ToolArtifactEvidenceRecord>();
    for (const rule of policy?.Evidence ?? []) {
    for (const record of projectEvidenceRule(value, rule)) {
      record.evidenceUri = createAgentEvidenceUri({
        artifactId,
        evidenceKey: record.key,
      });
      evidence.set(record.key, record);
    }
  }

  return [...evidence.values()];
}

function projectEvidenceRule(
  root: unknown,
  rule: ToolArtifactEvidenceManifest,
): ToolArtifactEvidenceRecord[] {
  if (!conditionMatches(root, rule.When)) {
    return [];
  }

  return projectScopedEvidenceRule(root, rule);
}

function projectScopedEvidenceRule(
  root: unknown,
  rule: ToolArtifactEvidenceManifest,
): ToolArtifactEvidenceRecord[] {
  const records = selectJsonValues(root, rule.Records);
  const projected: ToolArtifactEvidenceRecord[] = [];

  records.forEach((record) => {
    const slots = projectSlots(root, record, rule.Slots);
    const identity = resolveIdentityValues(slots, rule.Identity.Parts);
    if (!identity) {
      return;
    }

    const key = evidenceKey(rule.Kind, identity);
    if (!key) {
      return;
    }

    const presentationScope = {
      ...slots,
      kind: rule.Kind,
    };
    const locator = renderEvidenceTemplate(rule.Presentation.Locator, presentationScope);
    const display = renderEvidenceTemplate(rule.Presentation.Display, presentationScope);
    const label = renderEvidenceTemplate(rule.Presentation.Label, presentationScope);
    const source = renderEvidenceTemplate(rule.Presentation.Source, presentationScope);
    if (!locator || !display || !label || !source) {
      return;
    }
    const metadata = projectSlots(root, record, rule.Metadata ?? {});
    const modelSlots = projectModelSlots(slots, rule.ModelProjection.Slots);
    const plannerMemory = {
      facts: projectModelSlots(slots, rule.PlannerMemory.Facts),
      artifactRefs: [...(rule.PlannerMemory.ArtifactRefs ?? [])],
    };

    projected.push({
      key,
      evidenceUri: "",
      kind: rule.Kind,
      locator,
      display,
      label,
      source,
      confidence: rule.Confidence,
      slots,
      modelSlots,
      plannerMemory,
      metadata,
    });
  });

  return projected;
}

function projectModelSlots(
  slots: Record<string, unknown>,
  names: readonly string[],
): Array<{ name: string; value: string }> {
  return names.flatMap((name) => {
    const value = normalizeModelSlotValue(slots[name]);
    return value === undefined ? [] : [{ name, value }];
  });
}

function normalizeModelSlotValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return stableStringify(value);
}

function projectSlots(
  root: unknown,
  record: unknown,
  slots: Record<string, ToolArtifactEvidenceSlotManifest>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(slots).flatMap(([name, slot]) => {
      const source = readSlotScope(slot) === "Root" ? root : record;
      const values = selectJsonValues(source, readSlotSelector(slot));
      const value = values.length <= 1 ? values[0] : values;
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function readSlotSelector(slot: ToolArtifactEvidenceSlotManifest): string {
  return typeof slot === "string" ? slot : slot.Selector;
}

function readSlotScope(slot: ToolArtifactEvidenceSlotManifest): "Record" | "Root" {
  return typeof slot === "string" ? "Record" : slot.Scope ?? "Record";
}

function resolveIdentityValues(
  slots: Record<string, unknown>,
  parts: NonNullable<ToolArtifactEvidenceManifest["Identity"]>["Parts"],
): string[] | undefined {
  const values: string[] = [];
  for (const part of parts) {
    const slotName = typeof part === "string" ? part : part.Slot;
    const required = typeof part === "string" ? true : part.Required !== false;
    const value = normalizeKeyPart(slots[slotName]);
    if (!value && required) {
      return undefined;
    }
    if (value) {
      values.push(value);
    }
  }

  return values.length > 0 ? values : undefined;
}

function conditionMatches(
  root: unknown,
  condition: ToolArtifactEvidenceManifest["When"],
): boolean {
  if (!condition) {
    return true;
  }

  if (typeof condition === "string") {
    return selectJsonValues(root, condition).some(Boolean);
  }

  const values = selectJsonValues(root, condition.Selector);
  if (condition.Exists !== undefined) {
    return condition.Exists ? values.length > 0 : values.length === 0;
  }
  if ("Equals" in condition) {
    return values.some((value) => scalarEquals(value, condition.Equals));
  }
  if (condition.In) {
    return values.some((value) =>
      condition.In?.some((candidate) => scalarEquals(value, candidate)));
  }

  return values.some(Boolean);
}

function scalarEquals(
  left: unknown,
  right: ToolArtifactConditionManifest["Equals"],
): boolean {
  return left === right;
}

function evidenceKey(kind: string, values: readonly string[]): string {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }

  return normalized.length === 1
    ? `${kind}:${normalized[0]}`
    : `${kind}:${JSON.stringify(normalized)}`;
}

function normalizeKeyPart(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return stableStringify(value);
}

function renderEvidenceTemplate(
  template: string,
  data: Record<string, unknown>,
): string | undefined {
  try {
    const text = String(EvidencePresentationRenderer.parseAndRenderSync(template, data)).trim();
    return text.length > 0 ? text : undefined;
  } catch (error) {
    throw new Error(`Evidence presentation template failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderArtifactTemplate(
  template: string,
  data: Record<string, unknown>,
): string | undefined {
  try {
    const text = String(ArtifactTemplateRenderer.parseAndRenderSync(template, data)).trim();
    return text.length > 0 ? text : undefined;
  } catch (error) {
    throw new Error(`Artifact template failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function redactSecrets(value: unknown, policy: ToolArtifactPolicyManifest | undefined): unknown {
  const keyPatterns = (policy?.Redact?.Keys ?? []).map((pattern) => new RegExp(pattern, "i"));
  const pathSelectors = new Set(policy?.Redact?.Paths ?? []);
  return redactValue(value, keyPatterns, pathSelectors, "$");
}

function requireWorkspacePolicy(
  policy: ToolArtifactPolicyManifest | undefined,
  toolName: string,
): ToolArtifactWorkspaceManifest {
  if (!policy?.Workspace) {
    throw new Error(`${toolName} 生成了 workspace artifact，但插件未声明 Artifacts.Workspace 策略。`);
  }
  return policy.Workspace;
}

function writeWorkspaceArtifacts(input: {
  workspaceRoot: string;
  policy: ToolArtifactPolicyManifest | undefined;
  toolName: string;
  workspaceCapture: NonNullable<ExecutedToolCallResult["workspaceCapture"]>;
  artifactDir: string;
  files: Record<string, string>;
}) {
  return new AgentWorkspaceArtifactWriter({
    workspaceRoot: input.workspaceRoot,
    workspacePolicy: requireWorkspacePolicy(input.policy, input.toolName),
    workspaceCapture: input.workspaceCapture,
    artifactDir: input.artifactDir,
    files: input.files,
  }).write();
}

function redactValue(
  value: unknown,
  keyPatterns: readonly RegExp[],
  pathSelectors: ReadonlySet<string>,
  currentPath: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      redactValue(entry, keyPatterns, pathSelectors, `${currentPath}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${currentPath}.${key}`;
    redacted[key] = isSensitiveKey(key, keyPatterns) || pathSelectors.has(childPath)
      ? "[REDACTED]"
      : redactValue(entry, keyPatterns, pathSelectors, childPath);
  }
  return redacted;
}

function isSensitiveKey(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(key));
}

function truncateText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 13))}\n[truncated]` : value;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`, Number.MAX_SAFE_INTEGER);
}

async function writeBoundedJson(filePath: string, value: unknown, maxBytes: number): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(text) <= maxBytes) {
    await writeText(filePath, text, maxBytes + 64);
    return;
  }

  await writeJson(filePath, {
    truncated: true,
    originalBytes: byteLength(text),
    preview: truncateText(text, maxBytes),
  });
}

async function writeText(filePath: string, value: string, maxBytes: number): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const text = byteLength(value) > maxBytes
    ? `${Buffer.from(value).subarray(0, maxBytes).toString("utf8")}\n[truncated]\n`
    : value;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, text, "utf8");
  await fs.rename(tempPath, filePath);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function stableHash(value: unknown): string {
  return cryptoHash(stableStringify(value));
}


function cryptoHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
