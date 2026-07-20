# Frontend Kill-Slop Audit

Audit date: 2026-07-14

Workspace chrome constraints updated: 2026-07-16

Scope: `Frontend/src`, `Frontend/README.md`, and frontend Storybook/Ladle stories. Generated output and dependencies are excluded.

## Result

| Stage                  | Groups | Hits |
| ---------------------- | -----: | ---: |
| Before the first pass  |     19 |  352 |
| Before this audit pass |     12 |  228 |
| After confirmed fixes  |     12 |  177 |

The remaining group count is not a quality score. Each remaining hit below has a code-level reason to stay or is outside the shipped product surface.

## Confirmed Fixes

| Files                                                               | Finding                                                    | Resolution                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ModelProviderModelList.tsx`                                        | Nested group/count pills and colored model-state pills     | Small-radius group controls, inline counts, neutral state surfaces         |
| `ModelCapabilityControls.tsx`                                       | Capability icons wrapped in repeated circular tiles        | Bare semantic icons; state remains in the switch and text                  |
| `ProviderConnectionList.tsx`, `VectorModelConfigView.tsx`           | Stock green status pills                                   | Neutral surfaces with the project moss color used only for state text      |
| `PresetOverlays.tsx`                                                | Blur overlays and large-radius floating panels             | Opaque surfaces, 8px radius, no backdrop blur                              |
| `ScrollToBottomButton.tsx`                                          | Floating pill with blur, ring, and wide shadow             | 8px radius and one compact, colorless shadow                               |
| `PluginConfigViews.tsx`, model dialogs, provider lifecycle dialogs  | Product surfaces still using `rounded-xl`                  | Unified to `rounded-lg`                                                    |
| `ChatComposer.tsx`                                                  | Regular UI guidance inherited monospace                    | UI sans for guidance; monospace retained on keyboard keys and file metrics |
| `ProfileFooter.tsx`, `SessionRows.tsx`                              | Connection and session summaries rendered as terminal text | UI sans with tabular numerals where needed                                 |
| `ThinkingSummaryBar.tsx`, `WorkflowRunControls.tsx`, `StepNode.tsx` | Summary labels and status copy rendered as terminal text   | UI sans; durations and counts use tabular numerals                         |
| `PresetWorkspace.tsx`, `PresetSidebar.tsx`                          | Format controls and ordinary metadata overused monospace   | UI sans for labels; tabular numerals for measured values                   |

## Retained Findings

### 06: Gradient

- `shared/code/CollapsibleCodeBlock.tsx`: the bottom fade indicates clipped code and points to hidden content. It is local and functional, not atmospheric decoration.

### 07 and 24: Brand Mark

- `shared/ui/Logo.tsx`: the serif wordmark and primitive SVG paths are the existing Senera brand asset. They are not reused as generic UI decoration.

### 09: Underline

- `styles/markdown.css`: underline is applied to actual Markdown links.

### 12 and 15: Non-Product Sources

- `design-system/tokens/*.stories.tsx`: typography specimens intentionally demonstrate type tokens.
- `shared/ui/Button.stories.tsx`: the add icon is a real command icon from lucide-react.
- `Frontend/README.md`: the arrow documents an event relationship.

### 16: Pulse

- `features/chat/ChatComposer.tsx`: pulse appears only when upload progress is indeterminate. It communicates an active transfer and is removed once a ratio exists.

### 19: Circular Geometry

Retained circles are constrained to shapes that are conventionally circular:

- Avatars and avatar crop masks: `MessageChrome.tsx`, `ProfileFooter.tsx`.
- Toggle tracks and knobs: model, plugin, provider, appearance, and JSON configuration controls.
- Progress bars and loading dots: `ChatComposer.tsx`, `HistoryRecoveryState.tsx`, `AgentExecutionFeed.tsx`.
- Status dots: session, workflow, plugin, and connection status.
- Scrollbar thumbs and color swatches: `ScrollArea.tsx`, `useAppearance.tsx`.
- Data-type tokens: `DataView.tsx`; these describe typed runtime values rather than marketing badges.

### 21: Large Radius

- `HistoryRecoveryState.tsx`: skeleton geometry mirrors the real chat bubbles.
- `UserMessageRow.tsx`: the message bubble uses one large outer radius and a smaller speaker corner; it is not nested inside another rounded surface.
- `SessionList.tsx`: `rounded-xl` is reserved for the single Desktop/Wide persistent workspace sidebar shell. It separates navigation chrome from the continuous chat canvas and is not repeated on session rows or nested cards.
- Remaining hits are design-system stories.

### 22: Clipped Borders

The product hits put `overflow-hidden`, `border`, and `rounded-lg` on the same element. The border owns the arc, so clipping does not erase its corners. This applies to:

- Message editing and model list groups.
- Plugin configuration lists.
- Profile and settings surfaces.
- JSON array/table controls.
- Context and dropdown menus.

Story-only hits are excluded from product QA.

### 27: Three-Column Layouts

- `PresetWorkspace.tsx`: three mutually exclusive format options form a segmented control.
- `SettingsWorkbench.tsx`: three mutually exclusive motion levels are a settings option set with descriptions.
- `JsonConfigForm.tsx`: responsive form fields, not statistic or feature cards.
- Remaining hits are component stories.

### 33: Monospace

Retained monospace text is limited to technical values:

- Source code, raw JSON/TOML, shell commands, paths, URIs, IDs, and rule names.
- Timestamps, duration readouts, byte counts, line counts, and token counts.
- Keyboard shortcuts.
- Design-token specimens in stories.

Ordinary navigation, status copy, summaries, and descriptive text use the UI font.

## 34: 公共值选择菜单

- MenuSelect 是已经确认的值选择公共组件，保留当前紧凑密度、纸面触发器、焦点边界和中性的选项列表。
- DropdownMenu 继续负责动作菜单；值选择默认不继承动作菜单的标题、分隔线、危险操作或选中勾。
- 供应商和模型图标只有在确实表达品牌语义时才显示，不能用通用设置图标充当尾部装饰。
- 选项内容允许独立于触发器调整宽度，较长的模型标识不能被不必要地截断。
- 当前方案已经确认，候选 A 和候选 B 的讨论 Story 已删除。

## Visual QA

- Desktop: 1440 x 960, long assistant response with persistent workflow panel.
- Mobile: 390 x 844, long response and composer.
- Checked: no horizontal overflow, no clipped composer controls, no overlapping headers, and stable panel boundaries.

## Regression Checklist

- Run the scanner and review new hits; do not treat the hit count as a pass/fail score.
- Reject new page-level radial gradients, backdrop-blur surfaces, and `transition-all`.
- Keep ordinary product surfaces at 6-10px radius. The Desktop/Wide persistent workspace sidebar may use 12px as the single shell-level exception; avatars, toggles, progress tracks, and chat bubbles continue to follow their geometry.
- Do not separate persistent chat workspace regions primarily with full-height `border-r` or full-width high-contrast top-bar `border-b`; use shell spacing, neutral surface contrast, and the existing semantic surface shadow. Low-contrast `border-r`/`border-b` boundaries remain valid inside the settings workbench, forms, tables, and other functional editing shells when they clarify navigation or field grouping.
- Keep the central conversation workspace as one continuous canvas; do not wrap it in another rounded, bordered card.
- Preserve Electron drag regions and the window-controls inset when changing workspace chrome.
- Use monospace only when character alignment or literal technical identity matters.
- Prefer neutral state surfaces; reserve terra, moss, umber, and brick for state signals.
- Verify changed surfaces at 390px and 1440px before merging.

## 35. 公共布尔开关（2026-07-19）

- `shared/ui/Switch.tsx` 是所有布尔设置的生产公共组件。它统一负责轨道、滑块、细焦点边界、禁用态、`role="switch"`、`aria-checked` 和主题强调色。
- 焦点只保留 1px 的细边界，不使用 2px 彩色光圈；开关旁边不重复显示“已启用/已关闭”或 ON/OFF。
- 开启状态默认只使用主题强调色。moss/绿色只用于成功、连接、健康和可用状态，不是通用开关颜色。
- `SwitchTrack` 是已经由整张卡片或整行按钮负责交互时使用的非交互视觉部分，并且标记为 `aria-hidden`，避免出现嵌套交互元素。
- `Switch` 只渲染轨道和滑块；业务外壳可以在旁边放标题、说明或图标，但不能给开关再包一层带边框的按钮外壳，也不能重复绘制轨道。
- 向量模型页不再把 ON/OFF 文字和 `RefreshCw` 组合成伪开关；现在使用公共开关，刷新只在确实表示刷新动作时单独保留。
- 模型分组编辑不在本轮迁移范围，旧编辑器已经删除。未来恢复该能力时单独设计。

2026-07-19 的扫描结果是 10 组、149 个命中。上一次人工确认的基线是 148；多出的 1 个来自有意新增的 `Switch.tsx` 轨道和滑块。这是有明确功能意义的控件形状，不是装饰性 slop，应继续保留在已确认的圆形几何例外中。
