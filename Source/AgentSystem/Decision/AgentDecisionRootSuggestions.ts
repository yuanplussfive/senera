import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import {
  AgentDefaultXmlProtocolSpec,
  type AgentXmlProtocolSpec,
} from "../Xml/AgentXmlPolicy.js";

export class AgentDecisionRootSuggestions {
  constructor(
    private readonly registry?: AgentPluginRegistry,
    private readonly protocol?: AgentXmlProtocolSpec,
  ) {}

  toolCallsRootName(): string {
    return this.registry
      ?.listDecisionActions()
      .find((item) => item.kind === "ToolCalls")
      ?.xmlRoot
      ?? this.protocol?.roots.toolCalls
      ?? AgentDefaultXmlProtocolSpec.roots.toolCalls;
  }

  allowedDecisionRoots(): string[] {
    return this.registry?.listDecisionActions().map((item) => item.xmlRoot) ?? [];
  }

  allowedRootSuggestion(allowedRoots = this.allowedDecisionRoots()): string {
    return `把根标签改成允许的决策根标签之一：${allowedRoots.join(", ")}。`;
  }

  unknownDecisionRoot(options: {
    rootName: string;
    allowedRoots: string[];
  }): string {
    return [
      this.allowedRootSuggestion(options.allowedRoots),
      `如果 <${options.rootName}> 是要展示给用户的正文、代码或标记内容，不要把它作为工具调用 XML 输出；普通回复应直接输出自然语言，不需要 XML 外壳。`,
    ].join(" ");
  }
}
