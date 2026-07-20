export type WorkspaceApplyPatchAddOperation = {
  // 创建新文件。目标已存在时失败，避免意外覆盖。
  kind: "add";

  // 工作区内相对路径，或工作区内绝对路径。
  path: string;

  // 新文件完整文本内容。
  content: string;
};

export type WorkspaceApplyPatchUpdateOperation = {
  // 对已有文件应用 unified hunk patch。
  kind: "update";

  // 工作区内相对路径，或工作区内绝对路径。
  path: string;

  // 只包含 @@ hunk 的 unified patch，不包含 diff --git、---、+++ 文件头。
  patch: string;

  // 可选的当前文件 SHA-256。文件与读取时不一致则拒绝提交。
  expectedSha256?: string;
};

export type WorkspaceApplyPatchReplaceOperation = {
  // 用完整文本替换已有文件，适合大范围重写。
  kind: "replace";

  path: string;
  content: string;
  expectedSha256?: string;
};

export type WorkspaceApplyPatchDeleteOperation = {
  // 删除已有文件。
  kind: "delete";

  // 工作区内相对路径，或工作区内绝对路径。
  path: string;

  expectedSha256?: string;
};

export type WorkspaceApplyPatchMoveOperation = {
  // 移动或重命名已有文件，可在移动时同时应用 hunk patch。
  kind: "move";

  // 源文件路径。
  source: string;

  // 目标文件路径。目标已存在时失败。
  destination: string;

  // 可选。只包含 @@ hunk 的 unified patch，应用到源文件内容后写入目标。
  patch?: string;

  expectedSha256?: string;
};

export type WorkspaceApplyPatchCreateDirectoryOperation = {
  // 创建目录。目录已存在时视为成功。
  kind: "createDirectory";

  // 目录路径。
  path: string;
};

export type WorkspaceApplyPatchDeleteDirectoryOperation = {
  // 删除目录。默认只删除空目录。
  kind: "deleteDirectory";

  // 目录路径。不能是工作区根目录。
  path: string;

  // 是否递归删除目录内容。
  recursive?: boolean;
};

export type WorkspaceApplyPatchOperation =
  | WorkspaceApplyPatchAddOperation
  | WorkspaceApplyPatchUpdateOperation
  | WorkspaceApplyPatchReplaceOperation
  | WorkspaceApplyPatchDeleteOperation
  | WorkspaceApplyPatchMoveOperation
  | WorkspaceApplyPatchCreateDirectoryOperation
  | WorkspaceApplyPatchDeleteDirectoryOperation;

export type WorkspaceApplyPatchArguments = {
  // 一个逻辑补丁内的文件/目录操作。每个路径只能出现一次；同一文件多个修改应合并成一个 hunk patch。
  operations: WorkspaceApplyPatchOperation[];

  // true 时只校验并计算计划，不写入磁盘。
  dryRun?: boolean;

  // 允许的 hunk 上下文模糊匹配行数。默认 0，最大 3。
  fuzzFactor?: number;
};
