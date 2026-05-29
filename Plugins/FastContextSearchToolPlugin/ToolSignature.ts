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
