# FastContextWorkspaceMapTool

## 简述

查看真实工作区结构、项目线索和推荐搜索 roots。

## 何时使用

不确定目录、入口或搜索范围时先用它。

## 不要使用的情况

不要用于读取文件内容、搜索代码、联网或修改文件。

## 输入

`maxChildrenPerRoot` 可选，控制每个顶层目录返回多少直接子路径。

## 输出

返回 workspaceRoot、topLevel、availableRoots、project.markers/sourceRoots/entryPoints/recommendedRoots 和 guidance。

## 调用示例

```xml
<tool_calls>
  <tool_call>
    <name>FastContextWorkspaceMapTool</name>
    <arguments>
      <maxChildrenPerRoot>24</maxChildrenPerRoot>
    </arguments>
  </tool_call>
</tool_calls>
```

## 执行约束

只读工作区目录；不要猜不存在的 roots，优先看 project.recommendedRoots 和 availableRoots。
