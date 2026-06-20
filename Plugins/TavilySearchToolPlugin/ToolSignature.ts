export type TavilySearchToolArguments = {
  // 搜索查询。必须是明确、可直接检索的问题或关键词。
  query: string

  // 搜索深度；默认 basic。advanced 更相关但更慢更贵；fast/ultra-fast 更低延迟。
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast"

  // 搜索主题；默认 general。新闻实时事件使用 news，财经市场类信息使用 finance。
  topic?: "general" | "news" | "finance"

  // 返回结果数量，范围 1..20；默认 5。
  maxResults?: number

  // 是否包含 Tavily 生成的答案；默认 false。可用 basic 或 advanced 控制答案深度。
  includeAnswer?: boolean | "basic" | "advanced"

  // 是否包含原始正文；默认 false。markdown 返回清理后的 Markdown，text 返回纯文本。
  includeRawContent?: boolean | "markdown" | "text"

  // 是否包含图片搜索结果；默认 false。
  includeImages?: boolean

  // includeImages 为 true 时，是否包含图片描述；默认 false。
  includeImageDescriptions?: boolean

  // 是否包含每个搜索结果的 favicon；默认 false。
  includeFavicon?: boolean

  // 只搜索这些域名。XML 写法：<includeDomains><item>example.com</item></includeDomains>。
  includeDomains?: {
    item: string[]
  }

  // 排除这些域名。XML 写法：<excludeDomains><item>example.com</item></excludeDomains>。
  excludeDomains?: {
    item: string[]
  }

  // 发布时间范围过滤。
  timeRange?: "day" | "week" | "month" | "year" | "d" | "w" | "m" | "y"

  // news 主题可用，表示向前追溯多少天。
  days?: number

  // 起始日期，格式 YYYY-MM-DD。
  startDate?: string

  // 结束日期，格式 YYYY-MM-DD。
  endDate?: string

  // advanced 搜索时每个来源最多返回的内容片段数，范围 1..3。
  chunksPerSource?: number

  // general 主题可用，用于提升指定国家/地区的结果，例如 china、united states。
  country?: string

  // 让 Tavily 自动选择部分搜索参数；默认 false。
  autoParameters?: boolean

  // 是否只返回包含查询中引号短语的结果；默认 false。
  exactMatch?: boolean

  // 是否返回 Tavily credit 用量；默认 true。
  includeUsage?: boolean

  // 企业版安全搜索过滤；默认 false。不支持 fast 或 ultra-fast。
  safeSearch?: boolean

  // 本次 Tavily HTTP 请求超时，范围 1000..300000；默认使用插件配置 timeout_seconds。
  timeoutMs?: number
}
