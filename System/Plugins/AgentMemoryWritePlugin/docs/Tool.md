# MemoryWriteTool

## 简述
把用户明确要求记住的内容写入 active 长期记忆。写入前会和已有长期记忆做语义解析，重复内容会强化已有记忆而不是创建新条目。

## 何时使用
用户明确要求记录、记住、以后都这样、这是我的偏好、这是长期设定，或明确要求更新/替换一条已有长期记忆时使用。

## 不要使用的情况
不要把模型推断、普通任务结果、临时事实、工具输出、代码分析结论或没有用户明确要求记住的内容写入长期记忆。普通自动学习仍由后台候选记忆流程处理。

## 输入
- `operation`：默认 `create`；重复确认已有记忆用 `reinforce`，更新已有记忆用 `update`，替换旧记忆用 `supersede`。
- `type`：`profile/preference/knowledge/scene`。
- `subject`：记忆主体。
- `claim`：需要长期记住的具体陈述。
- `howToApply`：未来如何使用。
- `tags`：简短分类标签。
- `triggers`：未来应召回它的自然表达。
- `confidence`：0 到 1。
- `targetMemoryUri`：`reinforce/update/supersede` 时必填。未显式指定时，系统仍会在写入前尝试解析是否应强化已有记忆。
- `reason`：可选写入原因。

## 输出
返回写入或强化后的 active 长期记忆。若内容不适合作为长期记忆，`status` 可能为 `skipped` 且不返回 memory item。`sourceRefs` 允许为空，表示这是显式工具写入而不是由对话 source 聚合晋升。

## 调用示例
<senera_tool_calls>
  <tool_call>
    <name>MemoryWriteTool</name>
    <arguments>
      <type>preference</type>
      <subject>assistant_work_style</subject>
      <claim>用户偏好从源头解决问题，避免硬编码和粗糙兜底。</claim>
      <howToApply>实现时优先使用结构化协议、统一模块、schema 和成熟库。</howToApply>
      <tags>
        <item>工作方式</item>
        <item>代码质量</item>
      </tags>
      <triggers>
        <item>不要硬编码</item>
        <item>从源头解决</item>
      </triggers>
      <confidence>0.95</confidence>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束
本工具会写入本地长期记忆数据库。工具调用时整条回复只能是工具 XML。
