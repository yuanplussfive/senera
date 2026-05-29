import {
  AgentXmlPathWildcard,
  type AgentXmlDecisionRuntimeFieldRule,
  type AgentXmlPathSegment,
  type AgentXmlProtocolPolicy,
} from "./AgentXmlPolicy.js";
import type { AgentSourceDiagnostic } from "./AgentSourceDiagnostic.js";

export interface AgentDecisionNormalizationResult {
  value: unknown;
  changed: boolean;
  diagnostics: AgentSourceDiagnostic[];
}

type XmlPath = Array<string | number>;

export class AgentDecisionRuntimeFieldNormalizer {
  private readonly rulesByRoot: Map<string, readonly AgentXmlDecisionRuntimeFieldRule[]>;

  constructor(private readonly policy: AgentXmlProtocolPolicy) {
    this.rulesByRoot = new Map(
      this.groupRules(policy.runtimeOnlyDecisionFieldRules)
        .map(([root, rules]) => [root, rules] as const),
    );
  }

  normalize(
    rootName: string,
    value: unknown,
    buildDiagnostic: (
      message: string,
      path: XmlPath,
      suggestion: string,
    ) => AgentSourceDiagnostic,
  ): AgentDecisionNormalizationResult {
    const rules = this.rulesByRoot.get(rootName) ?? [];
    if (rules.length === 0) {
      return {
        value,
        changed: false,
        diagnostics: [],
      };
    }

    const diagnostics: AgentSourceDiagnostic[] = [];
    const normalized = rules.reduce(
      (current, rule) =>
        this.stripPath(current, rule.path, [], diagnostics, buildDiagnostic),
      value,
    );

    return {
      value: normalized,
      changed: diagnostics.length > 0,
      diagnostics,
    };
  }

  private groupRules(
    rules: readonly AgentXmlDecisionRuntimeFieldRule[],
  ): Array<[string, readonly AgentXmlDecisionRuntimeFieldRule[]]> {
    return [...rules.reduce((map, rule) => {
      const current = map.get(rule.root) ?? [];
      map.set(rule.root, [...current, rule]);
      return map;
    }, new Map<string, AgentXmlDecisionRuntimeFieldRule[]>())];
  }

  private stripPath(
    node: unknown,
    rulePath: readonly (string)[],
    currentPath: XmlPath,
    diagnostics: AgentSourceDiagnostic[],
    buildDiagnostic: (
      message: string,
      path: XmlPath,
      suggestion: string,
    ) => AgentSourceDiagnostic,
  ): unknown {
    if (rulePath.length === 0) {
      return node;
    }

    const [segment, ...rest] = rulePath;

    return segment === AgentXmlPathWildcard
      ? Array.isArray(node)
        ? node.map((entry, index) =>
            this.stripPath(entry, rest, [...currentPath, index], diagnostics, buildDiagnostic))
        : node
      : this.stripRecordPath(node, segment, rest, currentPath, diagnostics, buildDiagnostic);
  }

  private stripRecordPath(
    node: unknown,
    segment: string,
    rest: readonly AgentXmlPathSegment[],
    currentPath: XmlPath,
    diagnostics: AgentSourceDiagnostic[],
    buildDiagnostic: (
      message: string,
      path: XmlPath,
      suggestion: string,
    ) => AgentSourceDiagnostic,
  ): unknown {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return node;
    }

    const record = node as Record<string, unknown>;
    if (!(segment in record)) {
      return node;
    }

    if (rest.length === 0) {
      const { [segment]: _removed, ...remaining } = record;
      const fieldPath = [...currentPath, segment];
      diagnostics.push(
        buildDiagnostic(
          `模型输出了运行时字段：${segment}。`,
          fieldPath,
          "删除运行时字段，只输出协议要求的决策字段；运行时元数据会由平台自动补充。",
        ),
      );
      return remaining;
    }

    return {
      ...record,
      [segment]: this.stripPath(
        record[segment],
        rest,
        [...currentPath, segment],
        diagnostics,
        buildDiagnostic,
      ),
    };
  }
}
