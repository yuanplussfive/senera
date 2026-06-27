export type FastContextScoutToolArguments = {
  // 本地工作区问题；工具会自己组合 marker、路径和文本检索并读取候选文件片段。
  question: string

  // 可选提示词、字段名、文件名片段或用户已知线索。
  hints?: {
    item: string[]
  }

  // 搜索根目录，路径相对工作区根目录；不确定时省略。
  roots?: {
    item: string[]
  }

  // 额外排除路径片段或 glob 名称。
  exclude?: {
    item: string[]
  }

  // 最多派生并执行的检索查询数量。
  maxQueries?: number

  // 每个查询返回的候选数量。
  maxResults?: number

  // 最终返回的文件数量。
  maxFiles?: number

  // 搜索命中上下文行数。
  contextLines?: number

  // 每个最终文件读取的行窗口大小。
  readLineWindow?: number

  // 是否刷新本地索引后搜索。
  refreshIndex?: boolean

  // 侦察模式。默认 llm；传 deterministic 时只使用本地确定性检索。
  planningMode?: "deterministic" | "llm"
}

export type FastContextHybridSearchToolArguments = {
  // 自然语言、路径片段、标识符或错误文本；默认使用混合检索。
  query: string

  // 搜索根目录，路径相对工作区根目录；不确定时省略。
  roots?: {
    item: string[]
  }

  // 额外排除路径片段或 glob 名称。
  exclude?: {
    item: string[]
  }

  // 返回结果数量，范围 1..50。
  maxResults?: number

  // 结果上下文行数，范围 0..20。
  contextLines?: number

  // 是否把 query 当正则交给 ripgrep；默认 false。
  regex?: boolean

  // 是否区分大小写；默认 false。
  caseSensitive?: boolean

  // 是否刷新本地索引后再搜索；默认 false。
  refreshIndex?: boolean
}

export type FastContextSymbolSearchToolArguments = {
  // 函数、组件、类型、类名或自然语言关键词。
  query: string

  // 搜索根目录，路径相对工作区根目录；不确定时省略。
  roots?: {
    item: string[]
  }

  // 额外排除路径片段或 glob 名称。
  exclude?: {
    item: string[]
  }

  // 限定符号类型。
  kind?: {
    item: Array<"function" | "class" | "interface" | "type" | "enum" | "const" | "component">
  }

  // 返回结果数量，范围 1..50。
  maxResults?: number

  // 是否刷新本地索引后再搜索；默认 false。
  refreshIndex?: boolean
}

export type FastContextSearchToolArguments = {
  // 自然语言、标识符或关键词查询；使用本地 ripgrep 精确搜索。
  query: string

  // 搜索根目录，路径相对工作区根目录；默认使用插件配置 roots。
  roots?: {
    item: string[]
  }

  // 额外排除路径片段或 glob 名称，例如 node_modules、Dist。
  exclude?: {
    item: string[]
  }

  // 返回结果数量，范围 1..50；默认使用插件配置 default_max_results。
  maxResults?: number

  // 每个命中周围返回的上下文行数，范围 0..20；默认使用插件配置 default_context_lines。
  contextLines?: number

  // 是否把 query 当正则交给 ripgrep；默认 false。
  regex?: boolean

  // 是否大小写敏感；默认 false。
  caseSensitive?: boolean
}
