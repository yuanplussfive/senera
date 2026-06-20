export type FastContextReadToolArguments = {
  // 要读取的工作区路径；文件返回内容片段，目录返回轻量子路径摘要。
  path: string

  // 起始行，1-based；默认 1。
  startLine?: number

  // 结束行，1-based；默认 startLine + 120。
  endLine?: number

  // 最大返回字符数，范围 500..50000；默认 12000。
  maxChars?: number
}

export type FastContextReadToolResult =
  | {
      kind: "file"
      path: string
      startLine: number
      endLine: number
      totalLines: number
      content: string
      truncated: boolean
    }
  | {
      kind: "directory"
      path: string
      children: { item: string[] }
      childCount: number
      directoryCount: number
      fileCount: number
      truncated: boolean
      guidance: { item: string[] }
    }
  | {
      kind: "missing_path"
      requestedPath: string
      nearestExistingParent: string
      parentChildren: { item: string[] }
      suggestions: { item: string[] }
      availableRoots: { item: string[] }
      guidance: { item: string[] }
    }
