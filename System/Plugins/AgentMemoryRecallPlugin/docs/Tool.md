# MemoryRecallTool

## 简述

查询 Senera 已经沉淀的长期记忆，返回用户画像、偏好、可复用知识或剧情状态等 durable context。

## 何时使用

当当前问题需要参考用户长期偏好、个人资料、过去明确教给系统的知识、角色/世界观状态，或需要按 `memoryUri/sourceRef/evidenceUri/artifactUri` 追溯相关记忆时使用。

## 不要使用的情况

不要用它读取项目源码、搜索当前工作区文件、查询网页或恢复普通工具结果正文；这些任务应使用对应的工作区、搜索、文档或 artifact 工具。

## 输入

- `query`：要回忆的自然语言问题或上下文。
- `scope`：可选记忆范围，支持 `all/profile/preference/knowledge/scene`。
- `limit`：可选返回条数。
- `refs`：可选精确引用，可传 `memoryUri`、`sourceRef`、`evidenceUri` 或 `artifactUri`。

## 输出

优先返回 `memories.item` 中的长期记忆、适用方式、命中来源、分数、置信度和 sourceRefs。

如果没有命中 active 长期记忆，工具会自动降级搜索普通历史对话，并在 `turns.item` 中返回 user/assistant 成对消息。普通历史对话只能作为上下文引用，不代表已经沉淀为长期偏好、画像或知识。

`sources` 提供简要溯源信息，`fallback` 说明是否发生了降级检索。

## 执行约束

本工具只读取本地长期记忆数据库，不访问网络、不修改工作区。参数以 JSON 对象表达，由 Senera 运行时、BAML 工具编译器或 Pi tool call 承载。
