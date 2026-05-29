export type FastContextIndexSearchToolArguments = {
  // 自然语言、标识符或关键词查询；使用本地轻量索引搜索。
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

  // 是否刷新索引后再搜索；默认 false。
  refreshIndex?: boolean
}

export type FastContextRefreshIndexToolArguments = {
  // 重新索引这些根目录；默认使用插件配置 roots。
  roots?: {
    item: string[]
  }

  // 是否强制重建；默认 true。
  force?: boolean
}
