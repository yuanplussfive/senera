# FastContextIndexSearchTool

## 简述

查询本地持久化全文/符号索引，用于跨文件宽召回和模糊定位。

## 何时使用

关键词不精确、中文英文混合、需要离线索引召回、需要从自然语言联想到代码位置，或已经刷新过索引后继续查找时使用。

## 不要使用的情况

普通一次性定位优先用 `FastContextHybridSearchTool`。已知精确字符串用 `FastContextSearchTool`。只想刷新索引用 `FastContextRefreshIndexTool`。读取内容用 `FastContextReadTool`。

## 配置

读取 `PluginConfig.toml` 的 roots、exclude、索引文件数、结果数、文件大小和 `.state` 路径；不按扩展名白名单拦截。

## 输入

`query` 必填，可选 roots、exclude、maxResults、refreshIndex。设置 `refreshIndex=true` 会先刷新索引再查询。

## 输出

返回 path、line、snippet、score、stats 和 warnings。

## 调用示例

<senera_tool_calls>
  <tool_call>
    <name>FastContextIndexSearchTool</name>
    <arguments>
      <query>左侧 会话 消息 数量</query>
      <maxResults>8</maxResults>
    </arguments>
  </tool_call>
</senera_tool_calls>

## 执行约束

只读工作区并写入插件 `.state`。结果是候选线索，修改前继续读取确认。
