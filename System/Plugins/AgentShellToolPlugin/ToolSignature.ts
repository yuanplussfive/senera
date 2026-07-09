export type ShellCommandToolArguments = {
  // 要在当前平台 shell 中执行的完整命令，例如 "rg AgentLoop Source"、"npm run build"、
  // Windows PowerShell: "$c=Get-Content -Path Source\\File.ts; $c[0..120]"、"Get-Command pm2"，
  // Linux/macOS sh: "sed -n '1,120p' Source/File.ts"。
  command: string

  // 执行目录，相对工作区根目录；默认 "."。必须留在工作区内。优先使用工作区相对路径。
  cwd?: string

  // 超时时间，毫秒；默认使用系统 ToolExecution.TimeoutMs，最大 1800000。
  timeoutMs?: number

  // 简短说明为什么需要执行该命令，便于用户查看执行记录。
  justification?: string
}
