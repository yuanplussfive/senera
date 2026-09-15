import type { AgentDocumentProbeResult } from "./AgentDocumentProbeTypes.js";
import type {
  AgentDocumentExtractInput,
  AgentDocumentExtractorConfig,
  AgentDocumentExtractorHandler,
  AgentDocumentExtractorSelection,
} from "./AgentDocumentExtractorTypes.js";
import type { AgentDocumentExtractOptions, AgentDocumentExtractResult } from "./AgentDocumentExtractTypes.js";
import { AgentDocumentOfficeExtractor } from "./AgentDocumentOfficeExtractor.js";
import { AgentDocumentTextExtractor } from "./AgentDocumentTextExtractor.js";

export class AgentDocumentExtractorRegistry {
  private readonly handlers: ReadonlyMap<string, AgentDocumentExtractorHandler>;

  constructor(handlers: Iterable<AgentDocumentExtractorHandler>) {
    this.handlers = new Map([...handlers].map((handler) => [handler.type, handler]));
  }

  select(
    probe: AgentDocumentProbeResult,
    extractors: Record<string, AgentDocumentExtractorConfig>,
  ): AgentDocumentExtractorSelection | undefined {
    return Object.entries(extractors)
      .filter(([, config]) => config.enabled)
      .sort((left, right) => right[1].priority - left[1].priority)
      .flatMap(([name, config]) => {
        const handler = this.handlers.get(config.type);
        const selection = handler?.select({
          name,
          config,
          probe,
        });
        return selection ? [selection] : [];
      })
      .at(0);
  }

  extract(input: {
    document: AgentDocumentExtractInput;
    options: AgentDocumentExtractOptions;
    probe: AgentDocumentProbeResult;
    selection: AgentDocumentExtractorSelection;
  }): Promise<AgentDocumentExtractResult> {
    const handler = this.handlers.get(input.selection.config.type);
    if (!handler) {
      throw new Error(`文档抽取器类型未注册：${input.selection.config.type}`);
    }

    return handler.extract({
      input: input.document,
      options: input.options,
      probe: input.probe,
      selection: input.selection,
    });
  }
}

export const DefaultAgentDocumentExtractorRegistry = new AgentDocumentExtractorRegistry([
  AgentDocumentOfficeExtractor,
  AgentDocumentTextExtractor,
]);
