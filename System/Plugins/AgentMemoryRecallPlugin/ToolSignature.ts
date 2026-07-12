export type MemoryRecallScope = "all" | "profile" | "preference" | "knowledge" | "scene";

export type MemoryRecallToolArguments = {
  // 想回忆的用户、偏好、知识或剧情上下文。
  query: string;

  // 记忆范围；默认 all。
  scope?: MemoryRecallScope;

  // 返回条数；默认由工具内部策略决定。
  limit?: number;

  // 可选的精确引用，可传 memoryUri、sourceRef、evidenceUri 或 artifactUri。
  refs?: {
    item: string[];
  };
};

export type MemoryRecallToolResult = {
  query: string;
  scope: MemoryRecallScope;
  limit: number;
  refs: {
    item: string[];
  };
  memories: {
    item: Array<{
      memoryUri: string;
      type: string;
      subject: string;
      claim: string;
      howToApply: string;
      tags: {
        item: string[];
      };
      triggers: {
        item: string[];
      };
      sourceRefs: {
        item: string[];
      };
      matchedBy: {
        item: string[];
      };
      score: number;
      confidence: number;
      updatedAt: string;
      localDate: string;
    }>;
  };
  turns: {
    item: Array<{
      episodeUri: string;
      requestId: string;
      userMessage: {
        sourceRef: string;
        text: string;
        summary: string;
      };
      assistantMessage: {
        sourceRef: string;
        text: string;
        summary: string;
      };
      sourceRefs: {
        item: string[];
      };
      matchedBy: {
        item: string[];
      };
      score: number;
      startedAt: string;
      completedAt: string;
      localDate: string;
    }>;
  };
  sources: {
    item: Array<{
      sourceRef: string;
      sourceKind: string;
      role: string;
      summary: string;
      evidenceUri: string;
      artifactUri: string;
      toolName: string;
      createdAt: string;
      localDate: string;
    }>;
  };
  fallback: {
    used: boolean;
    reason: string;
  };
  warnings: {
    item: string[];
  };
  guidance: string;
};
