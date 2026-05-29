export type FastContextSearchToolArguments = {
  // 自然语言或关键词查询。用于本地 ripgrep 精确召回和 FlexSearch 全文召回。
  query: string

  // 搜索根目录，路径相对工作区根目录；默认使用插件配置 roots。
  roots?: {
    item: string[]
  }

  // 只搜索这些扩展名，例如 .ts、.md；默认使用插件配置 include_extensions。
  includeExtensions?: {
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

  // 是否刷新本地 FlexSearch 索引后再搜索；默认 false。
  refreshIndex?: boolean
}

export type FastContextReadToolArguments = {
  // 要读取的文件路径，必须在工作区内。
  path: string

  // 起始行，1-based；默认 1。
  startLine?: number

  // 结束行，1-based；默认 startLine + 120。
  endLine?: number

  // 最大返回字符数，范围 500..50000；默认 12000。
  maxChars?: number
}

export type FastContextRefreshIndexToolArguments = {
  // 重新索引这些根目录；默认使用插件配置 roots。
  roots?: {
    item: string[]
  }

  // 是否强制重建；默认 true。
  force?: boolean
}

export type FastContextWorkspaceMapToolArguments = {
  // 每个顶层目录最多返回的直接子路径数量，范围 0..80；默认 24。
  maxChildrenPerRoot?: number
}
