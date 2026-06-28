import type {
  ToolArtifactConditionManifest,
  ToolArtifactEvidenceManifest,
  ToolArtifactEvidenceSlotManifest,
  ToolArtifactPolicyManifest,
} from "../Types/PluginManifestTypes.js";
import type {
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";
import { selectJsonValues } from "./AgentArtifactJsonSelector.js";
import { stableArtifactStringify } from "./AgentArtifactStableJson.js";
import { createAgentEvidenceUri } from "./AgentEvidenceUri.js";
import { renderEvidenceTemplate } from "./AgentArtifactTemplateProjection.js";

export function collectArtifactEvidence(
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
  return conditionMatches(root, rule.When) ? projectScopedEvidenceRule(root, rule) : [];
}

function projectScopedEvidenceRule(
  root: unknown,
  rule: ToolArtifactEvidenceManifest,
): ToolArtifactEvidenceRecord[] {
  return selectJsonValues(root, rule.Records).flatMap((record) => {
    const slots = projectSlots(root, record, rule.Slots);
    const identity = resolveIdentityValues(slots, rule.Identity.Parts);
    if (!identity) {
      return [];
    }

    const key = evidenceKey(rule.Kind, identity);
    if (!key) {
      return [];
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
      return [];
    }

    return [{
      key,
      evidenceUri: "",
      kind: rule.Kind,
      locator,
      display,
      label,
      source,
      confidence: rule.Confidence,
      slots,
      modelSlots: projectModelSlots(slots, rule.ModelProjection.Slots),
      plannerMemory: {
        facts: projectModelSlots(slots, rule.PlannerMemory.Facts),
        artifactRefs: [...(rule.PlannerMemory.ArtifactRefs ?? [])],
      },
      metadata: projectSlots(root, record, rule.Metadata ?? {}),
    }];
  });
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
  return stableArtifactStringify(value);
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

  return stableArtifactStringify(value);
}
