export type WorkspaceReadFileArguments = {
  // 绝对路径或工作区内文件路径。MCP filesystem server 会限制在允许目录内。
  path: string

  // 可选起始行。
  head?: number

  // 可选尾部行数。
  tail?: number
}

export type WorkspaceListDirectoryArguments = {
  // 绝对路径或工作区内目录路径。
  path: string
}

export type WorkspaceSearchFilesArguments = {
  // 搜索根目录。
  path: string

  // glob 路径模式，例如 **/*AgentLoop*。
  pattern: string

  // 排除模式。
  excludePatterns?: string[]
}

export type WorkspaceGrepArguments = {
  // 要搜索的文本或正则模式。
  pattern: string

  // 搜索路径。
  path: string

  // 是否区分大小写。
  caseSensitive?: boolean

  // glob 文件过滤，例如 *.ts。
  filePattern?: string

  // 最大结果数量。
  maxResults?: number

  // 上下文行数。
  context?: number
}

export type WorkspaceListFilesArguments = {
  // 要列出文件的路径。
  path: string

  // glob 文件过滤，例如 *.ts。
  filePattern?: string

  // ripgrep 文件类型，例如 ts、json。
  fileType?: string

  // 是否包含隐藏文件。
  includeHidden?: boolean
}

export type WorkspaceEditFileOperation = {
  // 要匹配替换的原始文本。必须来自已经读取或明确存在的文件内容。
  oldText: string

  // 替换后的文本。
  newText: string
}

export type WorkspaceEditFileArguments = {
  // 绝对路径或工作区内文件路径。
  path: string

  // 一个或多个局部替换操作。
  edits: WorkspaceEditFileOperation[]

  // 是否只预览 diff，不写入文件。
  dryRun?: boolean
}

export type WorkspaceWriteFileArguments = {
  // 绝对路径或工作区内文件路径。
  path: string

  // 完整文件内容。会覆盖已有文件。
  content: string
}

export type WorkspaceCreateDirectoryArguments = {
  // 要创建或确认存在的目录路径。
  path: string
}

export type WorkspaceMoveFileArguments = {
  // 源文件或目录路径。
  source: string

  // 目标文件或目录路径。目标已存在时 MCP server 会失败。
  destination: string
}
