# TavilySearchTool

## 简述

使用 Tavily 执行实时网页搜索。

## 何时使用

需要最新信息、新闻、资料核验、来源链接、产品或市场信息时使用。

## 不要使用的情况

不要用于本地/代码搜索或无需联网的问题。缺少搜索目标时用 `AskUserTool`。

## 配置

读取插件目录 `PluginConfig.toml`。`[tavily].api_keys` 支持多个 key 轮询。

## 输入

`query` 必填。常用：`topic`、`searchDepth`、`maxResults`、`includeAnswer`、`includeDomains`、`excludeDomains`、`timeRange`、`startDate`、`endDate`。

## 输出

返回查询、答案、结果列表、图片、用量和请求信息。结果含标题、URL、摘要、分数和发布日期。

## 执行约束

不要传 API key。引用事实时使用返回的标题和 URL。
