export type ApplyPatchToolArguments = {
  // 必填。编辑操作数组；XML 写法：重复 <item>。
  operations: {
    item: Array<{
      // 必填。编辑动作。
      // create_file: 新建文件，需 content。
      // replace_file: 替换整个文件，需 content。
      // delete_file: 删除文件。
      // insert_before: 插入到 startLine 之前，需 startLine 和 content。
      // insert_after: 插入到 startLine 之后，需 startLine 和 content。
      // replace_range: 替换 startLine..endLine，需 startLine、endLine 和 content。
      // delete_range: 删除 startLine..endLine，需 startLine 和 endLine。
      action:
        | "create_file"
        | "replace_file"
        | "delete_file"
        | "insert_before"
        | "insert_after"
        | "replace_range"
        | "delete_range"

      // 必填。相对 cwd 的文件路径。
      path: string

      // 行号从 1 开始。行级操作按 action 要求填写。
      startLine?: number

      // 行号从 1 开始。range 操作按 action 要求填写。
      endLine?: number

      // 新内容。多行文本直接写入；宿主会统一换行。
      content?: string
    }>
  }

  // 可选。相对工作区根目录的路径，用于解释 path；默认 "."。
  cwd?: string

  // 可选。true 时只校验和返回变更计划，不写入文件；默认 false。
  dryRun?: boolean

  // 可选。简短说明本次修改目的。
  justification?: string
}
