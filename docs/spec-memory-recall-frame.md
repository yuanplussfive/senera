# 形态 B 实现规格：记忆回述帧（Memory Recall Frame）

> 目标：在**不触碰稳定 system** 的前提下，把当前 turn_context 里"原始 wire 数据块"的记忆呈现，升级成模型的**第一人称回述（self-owned recollection）**——让模型把召回记忆当"自己记得的事"而不仅是"宿主数据"。
> 形态 B = 兼容性优先：不做 assistant `<thinking>` 预填（形态 A），留在既有的隐藏 `senera_turn_context` 消息通道内。

---

## 0. 结论摘要

| 维度          | 现状                                                                 | 目标（本规格落地后）                                                            |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| system 稳定性 | 永久稳定（已验证）                                                   | **不变**，一行不改                                                              |
| 记忆所在      | turn_context 里若干 wire 块（ContinuityWire/Facts/ResidentProfile…） | turn_context **顶部新增一个第一人称回述块**，下方保留结构化 wire 作为可引用证据 |
| 缓存          | turn_context 独立隐藏消息、append-only                               | **不变**；回述块确定性生成 → byte 稳定 → revision 稳定 → 缓存不破               |
| 注入安全      | attribution=root、not-user-input                                     | **不变**；回述块仍 host 投影、非指令、可忽略                                    |

---

## 1. 非协商约束（写死在规格里）

1. **`systemPrompt = frozen + stable` 不得被条件性改动**。任何新内容只能进 `turnContext`/turn_context。
2. **回述块必须确定性生成**：相同输入 → 逐字相同字节。不得依赖 LLM 生成，否则跨轮 byte 漂移破坏缓存与 revision。
3. **安全语义保留**：回述块带 `provenance=host-projected;not-user-input`，且给模型"无关即忽略"的授权。
4. **token 受预算**：回述块只承载 top-N，尾部折叠；沿用 executor 里已有的 `AgentTurnTokenBudget` 风格，不自行新造预算模型。
5. **向后兼容**：默认行为不突变，用配置开关切换，可一键回滚到 wire-only。

---

## 2. 注入点与数据流（已核实）

```
AgentTurnPromptRenderer.render()
  ├─ systemPrompt = join(SeneraFrozenSystemPrompt, stable)   ← 稳定，本次不动
  └─ turnContext  = PiTurnVolatileContext 渲染
        ├─ VolatileWire / ContinuityWire / ContinuityFactsWire
        ├─ ResidentProfileWire / ResidentStateWire / SceneWire / WorkflowWire
        └─ sessionSpace + turnIdentity + reusableCapabilities

AgentPiTurnContextMessage.projectAgentPiTurnContextMessage()
  └─ 调用 renderPiSystemPromptFrame({ systemPrompt: turnContext, skills, templates, disclosure })
        └─ 产出隐藏消息 <senera_turn_context attribution="root" …> snapshot </…>
```

新增的**回述块**作为 `turnContext` 的**最前导 block** 写入 `PiTurnVolatileContext.liquid` 的 `reference_stage` 顶部，或由服务端拼进 `turnContext` 字符串前部（见 §4 取舍）。

---

## 3. 回述块的设计

### 3.1 放在哪

`<reference_stage>` 内、`RoleplayLore` 之前，新增一个 `<recall_stage>`：

```xml
<recall_stage attribution="root">
  <recall>以下是本轮的自我回述——把它当作你已经知道的事。
  数据准确口径仍以下方结构化 wire 为准；若与本轮任务无关，可忽略。</recall>
  {{ RecallStatement }}
</recall_stage>
```

### 3.2 回述内容结构

回述块由**确定性句子生成器**产出，形态：

```xml
<recall_stage attribution="root">
  <recall>第一人称、过去式、逐条回顾命中记忆；每条由（lead-in + 该条语义 + 来源锚）拼成。</recall>
  …… 若干条，按 confidence/score 降序 ……
  …… 折叠行："还有 N 点：以结构化 wire 为准。" ……
</recall_stage>
```

### 3.3 句式框架表（按记录 kind 分派，全确定性）

| 输入（来自 `AgentContinuityMemoryPromptContext`） | 框架                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `factCatalog[]`（claim, sourceRefs, confidence）  | "我记得不变的是：{claim}（来源 {首个 sourceRef}）。" |
| `eventCandidates[]`（summary, occurredAt）        | "那时经历过一次事件：{summary}。"                    |
| `graphRelations[]`                                | "我与他人的关系里：{relation 描述}。"                |
| `residentProfile[]`                               | "我对自己的认识上：{profile 描述}。"                 |
| `styleExamples[]`                                 | 不单列；作为语气配方喂给 人设宏（§3.4）              |

### 3.4 人设宏（确定性：人设不变 → 句式/虚词不变）

| 角色卡 `card.languageStyle` 命中 | 效果             |
| -------------------------------- | ---------------- |
| 未命中 / 无角色卡                | 中性："我记得 …" |
| 沉稳                             | "我记得很清楚 …" |
| 随性                             | "那事我记得 …"   |
| 戏剧化                           | "哦对，我记得 …" |

人设宏只能改变**固定虚词/标点**，**不得改动记录语义字段**。人设不变 → 字节不变。

### 3.5 token 预算与折叠

```
N = 由估算预算得出（默认值：语境窗口 2%，下限 256 token，与 formatReusableCapabilities 同风格）
top-N 逐条生成
超出 → 一行折叠："还有 M 点（facts/events/relations），以下方结构化 wire 为准。"
```

同一预算 → 同一集合 → 字节稳定。

---

## 4. 文件改动面（接口规格）

### 4.1 新增：`Source/AgentSystem/Continuity/AgentContinuityRecallStatement.ts`

```ts
export interface AgentContinuityRecallStatementOptions {
  personaMacro?: "neutral" | "composed" | "causal" | "dramatic";
  tokenBudget?: { estimateTokens(text: string): number; maxTokens?: number };
}
export function renderAgentContinuityRecallStatement(
  context: AgentContinuityMemoryPromptContext,
  opts?: AgentContinuityRecallStatementOptions,
): string; // 空态返回 ""
```

- 纯函数、无副作用、确定性。
- 输入即本次召回已产出的 `factCatalog/eventCandidates/graphRelations/residentProfile`，**不触发第二次检索**。

### 4.2 新增配置：`Prompt.RecallPresentation`

在 `AgentPromptConfig`/form 增加（字段均为**可选、有较好默认、向后兼容**）：

```ts
Prompt?.RecallPresentation?: {
  Mode?: "wire" | "recall-statement";   // 默认 "wire"（现行为），切 "recall-statement" 启用
  MaxEntries?: number;                   // top-N，默认按预算估算
  Emphasis?: "neutral" | "composed" | "causal" | "dramatic";  // 人设宏，默认 neutral
}
```

- 删改/回滚 = 改配置，不动代码路径。

### 4.3 接入：`AgentPiTurnContextMessage.ts`（唯一注入点）

在 `projectAgentPiTurnContextMessage` 内，把 `turnContext` 传入回述生成器前合并：

```
turnContext += renderAgentContinuityRecallStatement(continuityMemory, opts)
```

（`continuityMemory` 已由 renderer 作为入参持有。）若 `Mode==="wire"`，则 append 空串，行为与现在逐字节一致。
**注意**：不要在 `AgentTurnPromptRenderer` 的 stableKey 或 systemPrompt 里引入任何新输入。

### 4.4 模板：`System/Prompts/Templates/PiTurnVolatileContext.liquid`

`<reference_stage>` 顶部新增 `<recall_stage>` 可选项，渲染变量 `RecallStatement`；`wire` 模式下该变量为空，模板输出与现状一致（`RenderRecallStage=false` 时连标签都不输出，避免空壳）。

### 4.5 契约产物 / 校验（回归清单）

- [ ] `verify.config-form`（新增 `Prompt.RecallPresentation` 字段的表单投影校验）
- [ ] 契约产物再生成（config 命令/数据库契约、i18n 双语文本、表单投影）
- [ ] ToolSearch 无涉，不需改
- [ ] 新增单测：`renderAgentContinuityRecallStatement` 确定性（同输入同字节）、按 kind 分派、预算折叠、空态、人设宏稳定性

---

## 5. 缓存与安全的守恒证明（落地后仍需断言）

1. **缓存**：回述块只 append 进 turn_context（独立隐藏消息，append-only，近 user）；system 前缀不变 → implicit-prefix / breakpoint 命中模式不变；相同记忆 → 相同块 → revision 不变。
2. **注入安全**：块仍 `attribution=root; not-user-input`；回述句第一人称但语义字段来自召回记录，不改事实口径；结构化 wire 保留在下层为 evidence-refs 背书。
3. **可回滚**：置 `Mode:"wire"` 即回到纯 wire，字节一致，无残留。

---

## 6. 明确不做（防御过度拟合）

- 不做形态 A（assistant thinking prefill / 伪造 `role:tool` 帧）——等 pi-agent-core 支持 assistant thinking 预填后再评估，本规格不引入。
- 不在回述块里伪造"记忆已检索"的对话动作；真实检索仍由现有后台召回完成，帧只做"回述呈现"。
- 不在 stable/frozen 模板里加记忆相关说明（system 严禁动）；God Voice 若需，也只进 volatile 侧。

---

## 7. 验收判定

1. 配置 `RecallPresentation.Mode="recall-statement"` 时，turn_context 首块为第一人称回述；`"wire"` 时输出与历史基准确认字节一致。
2. `systemPrompt` 在开启前后**逐字节相同**。
3. 相同召回、相同人设宏、相同预算 → `renderAgentContinuityRecallStatement` 返回字节相同（测试断言）。
4. 全量回归（tsc --noEmit + 契约 verify + AgentRuntime services 契约 + i18n）通过。
