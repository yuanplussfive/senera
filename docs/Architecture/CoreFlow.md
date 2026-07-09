# 核心链路导览

这篇文档用于快速理解 Senera 的主流程。改动主循环、规划器、工具执行、记忆、事件投影或前端会话状态前，先看这里。

## 一次请求的主路径

```text
用户输入
  -> Apps 入口
  -> AgentSystemRuntime 装配运行时
  -> AgentLoop 驱动步骤
  -> TurnUnderstanding 改写当前用户意图
  -> InteractionRoute 选择直接回复或工具循环
  -> ActionPlanner 生成结构化规划输入
  -> PromptContextBuilder 组装模型上下文
  -> Pi Harness 驱动模型回复与工具循环
  -> Pi 原生 tools 或 PiProxy+BAML 编译工具调用
  -> ToolCallExecutor / 宿主能力 / 插件进程
  -> ArtifactRecorder 记录证据包
  -> Memory Learning 更新记忆
  -> Final Answer
  -> WebSocket 事件投影
  -> 前端 Session Projector 更新界面
```

## 每层负责什么

`Apps/*` 是入口层，负责 终端、Server、Desktop 的启动、路径、配置来源和传输协议。这里不应该写规划、工具、记忆或 artifact 业务逻辑。

`AgentSystemRuntime` 是装配层，负责创建服务、加载配置、扫描插件、注册能力。它可以知道有哪些服务，但不应该继续承载具体业务策略。

`AgentLoop` 是步骤驱动层，负责理解、路由、渲染提示词、启动 Pi turn 和收口最终回复。它消费 runtime services，并发出领域事件。

`ActionPlanner` 是结构化规划层，负责当前轮理解和交互路由。BAML 负责生成结构化输出，本地 schema 校验负责兜住最终形态。

`PromptContextBuilder` 是上下文投影层，负责把工具、技能、预设、记忆、运行状态投影成模型能吃的上下文。它不执行工具，也不修改运行状态。

`Pi` 是工具循环层。支持 tools 的模型直接走 Pi 原生工具调用；不支持 tools 的模型走 Senera PiProxy，把 Pi 的 OpenAI-compatible tools 请求交给 BAML 编译成结构化 assistant message。

`ToolRuntime` 是工具执行层，负责校验可见工具、保留 Pi toolCallId、运行宿主能力或插件进程，并把结果交给 artifact、日志和 Pi observation。

`ArtifactRecorder` 是可追溯证据层，负责写入工具输入、原始输出、摘要、证据、投影和工作区变更。模型和前端应该拿引用和摘要，不直接依赖临时进程输出。

`Memory` 是长期状态层，负责原始来源、候选记忆、晋升记忆、主动写入和回忆。记忆应该通过 source refs 和 repository 追溯，不应该重新临时解析聊天记录。

`AgentWebSocketServer` 是事件传输层，负责把后端领域事件序列化给前端。前端通过 projector 更新 UI 状态，不反向复制后端决策逻辑。

## 新能力的落地规则

新增能力尽量遵循这条路径：

```text
契约
  -> 运行时实现
  -> 模型/前端/artifact/日志投影
  -> 验证脚本
```

不要通过“主循环直接 import 一个具体工具、模型供应商、UI 状态”的方式加能力。优先让能力通过插件、runtime service、配置 schema、事件协议或前端 feature 边界注册进系统。

## 必跑验证

改核心链路时至少跑：

```bash
npm run check
npm run build
npm run verifysuite -- workspace core
npm run frontendverify
```

大改前后跑完整本地套件：

```bash
npm run verifyall
```
