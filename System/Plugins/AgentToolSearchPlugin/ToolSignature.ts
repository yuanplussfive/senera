export type ToolSearchToolArguments = {
  // 需要完成的任务、问题、错误文本或希望寻找的能力。
  query: string

  // 是否包含当前已经加载进提示词的工具；默认 false。
  includeLoaded?: boolean
}
