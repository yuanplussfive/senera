export type ToolSearchToolArguments = {
  // 需要完成的任务、问题、错误文本或希望寻找的能力。
  query: string;

  // 优先检索的插件来源；仅影响排序，不排除其他来源。可用值由当前插件目录动态注入。
  preferredSources?: string[];

  // 是否包含当前已经加载进提示词的工具；默认 false。
  includeLoaded?: boolean;
};

export type ToolSearchToolResult = {
  // 原始工具检索 query。
  query: string;

  // 本次使用的来源排序偏好。
  preferredSources: {
    item: string[];
  };

  // 匹配到的工具候选。
  tools: {
    item: Array<{
      name: string;
      title: string;
      sources: {
        item: Array<{
          id: string;
          title: string;
          description: string;
        }>;
      };
      summary: string;
      whenToUse: string;
      score: number;
      reason: string;
      matchedTerms: {
        item: string[];
      };
      matchedCapabilities: {
        item: Array<{
          id: string;
          title: string;
          score: number;
          matchedFacets: {
            item: string[];
          };
          risk?: {
            sideEffect?: string;
            permission?: string;
          };
        }>;
      };
      learningSignals: {
        item: Array<{
          term: string;
          source: string;
          support: number;
          confidence: number;
          score: number;
        }>;
      };
      permissions: {
        item: string[];
      };
    }>;
  };

  // 下一步如何使用结果。
  guidance: string;
};
