# FastContextScoutTool

## 简述

本地工作区检索子代理。默认使用宿主侧 BAML Scout Planner 做受限多轮侦察，并结合项目标记文件、路径模糊匹配、ripgrep、SQLite 索引和文件片段读取，返回最相关的文件路径、行号范围、原因和内容片段。只需要本地确定性检索时，可传 `planningMode=deterministic`。

## 何时使用

用户询问项目里的配置、实现位置、关键文件、错误来源、UI 文案、跨模块逻辑，且模型不知道准确路径时优先使用。适合“主模型配置文件怎么写”“这个项目入口在哪里”“某个错误是谁抛的”这类需要先定位再回答的问题。

## 不要使用的情况

已知精确文件路径时直接用 `FastContextReadTool`。已知精确字符串且只需要命中列表时用 `FastContextSearchTool`。只看目录结构时用 `FastContextWorkspaceMapTool`。

## 输入

`question` 必填。可选 `hints` 补充字段名、文件名、错误码或 UI 文案线索。`roots` 不确定时省略。`maxFiles` 控制最终返回文件数量，`readLineWindow` 控制每个文件读取范围。默认 `planningMode=llm` 会使用主程序统一模型配置和 BAML 结构化输出执行受限 `rg/readfile/tree/glob` 循环。

## 输出

返回 `queryPlan`、`files`、`searchRuns`、`diagnostics`。`files.item[*]` 是最终可引用证据，包含 path、startLine、endLine、reason、snippets、content。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextScoutTool</name>
    <arguments>
      <question>主模型配置文件怎么写？</question>
      <hints>
        <item>DefaultModelProviderId</item>
        <item>ModelProviders</item>
      </hints>
      <maxFiles>6</maxFiles>
    </arguments>
  </tool_call>
</senera_tool_calls>

深度侦察示例：

<senera_tool_calls>
  <tool_call>
    <name>FastContextScoutTool</name>
    <arguments>
      <question>认证链路从入口到 token 校验分别在哪些文件？</question>
      <planningMode>llm</planningMode>
      <maxFiles>8</maxFiles>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区；可能写入插件 `.state` 索引缓存。LLM Planner 只能请求结构化 `rg/readfile/tree/glob` 命令，不能执行 shell。输出的候选文件片段可以作为回答依据；如果需要修改或更大上下文，继续读取对应 path 和行号范围。
