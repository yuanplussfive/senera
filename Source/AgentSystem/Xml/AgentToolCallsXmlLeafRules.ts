import type { AgentPromptContractProperty } from "../Prompt/AgentPromptContractProjector.js";
import { AgentPromptContractProjector } from "../Prompt/AgentPromptContractProjector.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";

export interface ToolLeafRules {
  scalarTags: ReadonlySet<string>;
  scalarArrayParents: ReadonlySet<string>;
}

interface MutableToolLeafRules {
  scalarTags: Set<string>;
  scalarArrayParents: Set<string>;
}

type ToolProvider = () => readonly RegisteredTool[];

export class AgentToolCallsXmlLeafRuleReader {
  private readonly contractProjector = new AgentPromptContractProjector();
  private cacheKey = "";
  private cachedRules = new Map<string, ToolLeafRules>();

  constructor(
    private readonly protocol: AgentXmlProtocolSpec,
    private readonly tools: ToolProvider,
  ) {}

  readRules(): Map<string, ToolLeafRules> {
    const tools = this.tools();
    const cacheKey = tools
      .map((tool) => `${tool.name}\u0000${tool.signatureFile ?? ""}\u0000${tool.signatureType ?? ""}`)
      .join("\u0001");

    if (cacheKey === this.cacheKey) {
      return this.cachedRules;
    }

    this.cacheKey = cacheKey;
    this.cachedRules = new Map(
      tools.flatMap((tool) => {
        const rules = this.readToolRules(tool);
        return rules ? [[tool.name, rules] as const] : [];
      }),
    );
    return this.cachedRules;
  }

  private readToolRules(tool: RegisteredTool): ToolLeafRules | undefined {
    if (!tool.signatureFile) {
      return undefined;
    }

    const contract = this.contractProjector.projectFromFile(
      tool.signatureFile,
      "arguments",
      tool.signatureType,
    );
    const rules: MutableToolLeafRules = {
      scalarTags: new Set(),
      scalarArrayParents: new Set(),
    };
    contract?.properties.forEach((property) => this.collectRules(property, rules));

    return rules.scalarTags.size > 0 || rules.scalarArrayParents.size > 0
      ? rules
      : undefined;
  }

  private collectRules(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    ({
      scalar: () => this.collectScalarRule(property, rules, parentTag),
      object: () => property.children.forEach((child) =>
        this.collectRules(child, rules, property.name)),
      array: () => this.collectArrayRule(property, rules, parentTag),
    })[property.kind]();
  }

  private collectScalarRule(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    if (property.name === this.protocol.items.arrayItem && parentTag) {
      rules.scalarArrayParents.add(parentTag);
      return;
    }

    rules.scalarTags.add(property.name);
  }

  private collectArrayRule(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    const element = property.element;
    if (!element) {
      return;
    }

    if (element.kind === "scalar") {
      rules.scalarArrayParents.add(
        property.name === this.protocol.items.arrayItem && parentTag
          ? parentTag
          : property.name,
      );
      return;
    }

    if (element.kind === "object") {
      element.children.forEach((child) => this.collectRules(child, rules, property.name));
      return;
    }

    this.collectArrayRule(element, rules, property.name);
  }
}

