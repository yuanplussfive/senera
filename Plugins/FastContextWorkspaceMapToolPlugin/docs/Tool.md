# FastContextWorkspaceMapTool

## 简述

查看真实工作区顶层目录、可用搜索根、入口线索和推荐 roots。

## 何时使用

不知道项目有哪些目录、前端/后端/插件代码在哪里、roots 应该怎么填，或模型准备猜 `src`、`app`、`web` 这类常见目录名之前先用它。

## 不要使用的情况

不要用于搜索代码内容、读取文件片段、联网或修改文件。拿到目录和推荐 roots 后，再用 `FastContextHybridSearchTool` 搜索或 `FastContextReadTool` 读取。

## 输入

`maxChildrenPerRoot` 可选，控制每个顶层目录返回多少直接子路径。

## 输出

返回 workspaceRoot、topLevel、availableRoots、project.markers/sourceRoots/entryPoints/recommendedRoots 和 guidance。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextWorkspaceMapTool</name>
    <arguments>
      <maxChildrenPerRoot>24</maxChildrenPerRoot>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区目录；不要猜不存在的 roots，优先看 project.recommendedRoots 和 availableRoots。
